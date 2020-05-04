// game.js
// @author octopoulo <polluxyz@gmail.com>
// @version 2020-05-02
//
// Game specific code:
// - control the board, moves
// - create the tables
// - update stats
//
// included after: common, engine, global, 3d, xboard
/*
globals
_, A, Abs, add_timeout, Assign, Attrs, audiobox,
C, camera_look, camera_pos, change_setting, CHART_NAMES, Class, clear_timeout, controls, CreateNode, cube:true,
DEFAULTS, DEV, Events, Exp, Floor, FormatUnit, FromSeconds, get_object, HasClass, Hide, HOST_ARCHIVE, HTML, Id,
InsertNodes, Keys,
listen_log, load_model, Lower, LS, Max, merge_settings, Min, Now, ON_OFF, Pad, Parent, play_sound, Pow, reset_charts,
resize_3d, Resource, resume_game, Round,
S, save_option, save_storage, scene, set_3d_events, set_camera_control, set_camera_id, SetDefault, Show, show_menu,
show_modal, Sign, Split, start_3d, Style, TIMEOUTS, Title, Toggle, touch_handle, translate, translate_node,
update_live_chart, update_player_chart, update_svg, Upper, virtual_init_3d_special:true, virtual_random_position:true,
Visible, window, XBoard, Y
*/
'use strict';

let BOARD_THEMES = {
        blue: ['#e0e0e0', '#87a6bc'],
        brown: ['#eaded0', '#927b6d'],
        chess24: ['#9E7863', '#633526'],
        dark: ['#797877', '#585655'],
        dilena: ['#FFE5B6', '#B16228'],
        green: ['#f0e9db', '#7b9d86'],
        leipzig: ['#FFFFFF', '#E1E1E1'],
        metro: ['#FFFFFF', '#EFEFEF'],
        red: ['#eaded0', '#b17278'],
        symbol: ['#FFFFFF', '#58AC8A'],
        uscf: ['#C3C6BE', '#727FA2'],
        wikipedia: ['#FFCE9E', '#D18B47'],
    },
    board_target,
    BOARDS = {
        board: {},
        pv0: {
            pv_id: '#player0 .live-pv',
        },
        pv1: {
            pv_id: '#player1 .live-pv',
        },
        pva: {
            size: 36,
        },
    },
    CACHE_TIMEOUTS = {
        brak: 1,
        crash: 600,
        cross: 1,
        sched: 240,
        season: 3600 * 24,
        tour: 1,
        winner: 3600 * 24,
    },
    ENGINE_FEATURES = {
        AllieStein: 1,                  // & 1 => NN engine
        LCZero: 3,                      // & 2 => Leela variations
    },
    LIVE_TABLES = Split('#table-live0 #table-live1 #player0 #player1'),
    NAMESPACE_SVG = 'http://www.w3.org/2000/svg',
    num_ply = 0,
    PAGINATIONS = {
        h2h: 10,
        sched: 10,
    },
    pgn,
    PIECE_KEYS  = Split('alpha chess24 dilena leipzig metro symbol uscf wikipedia'),
    PIECE_SIZES = {
        _: 80,
        metro: 160,
    },
    PIECE_TYPES = {
        _: 'png',
        // wikipedia: 'svg',            // will enable in the future
    },
    players = [{}, {}],                 // current 2 players
    prev_round,
    ROUND_NAMES = {
        1: 'Final',
        2: 'SemiFinal',
        4: 'QuarterFinal',
    },
    SCORE_NAMES = {
        0: 'loss',
        0.5: 'draw',
        1: 'win',
        '=': 'draw',
    },
    table_data = {},
    TABLES = {
        crash: 'gameno=G#|White|Black|Reason|decision=Final decision|action=Action taken|Result|Log',
        cross: 'Rank|Engine|Points',
        event: 'Round|Winner|Points|runner=Runner-up|# Games|Score',
        game: 'Game#|PGN|White|white_ev=W.ev|black_ev=B.ev|Black|Result|Moves|Duration|Opening|Termination|ECO|Start',
        h2h: 'Game#|White|white_ev=W.ev|black_ev=B.Ev|Black|Result|Moves|Duration|Opening|Termination|ECO|Final Fen',
        sched: 'Game#|White|white_ev=W.ev|black_ev=B.ev|Black|Result|Moves|Duration|Opening|Termination|ECO|Final Fen|Start',
        season: 'Season|Download',
        stand: 'Rank|Engine|Games|Points|Crashes|Wins [W/B]|Loss [W/B]|SB|Elo|Diff [Live]',
        stats: 'Start time|End time|Duration|Avg Moves|Avg Time|White wins|Black wins|Draw Rate|Crashes|Min Moves|Max Moves|Min Time|Max Time',
        view: 'TC|Adj Rule|50|Draw|Win|TB|Result|Round|Opening|ECO|Event|Viewers',
        winner: 'name=S#|winner=Champion|runner=Runner-up|Score|Date',
    },
    TIMEOUT_PLY_LIVE = 100,             // when moving the cursor, wait a bit before updating live history
    tour_info = {},
    virtual_opened_table_special,
    xboards = {},
    WHITE_BLACK = ['white', 'black', 'live'],
    WB_TITLES = ['White', 'Black'];

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// HELPERS
//////////

/**
 * The function was posted by "ya" in the Leela Chess Zero Discord channel
 * https://discordapp.com/channels/425419482568196106/430695662108278784/618146099269730342
 * - made it more readable
 * @param {number} cp
 * @returns {number}
 */
function _leelaCpToQ(cp) {
    if (cp < 234.18)
        return 0.0033898305085 * cp
            - (8.76079436769e-38 * Pow(cp, 15)) / (3.618208073857e-34 * Pow(cp, 14) + 1.0)
            + (cp * (-3.4456396e-5 * cp + 0.007076010851)) / (cp * cp - 487.329812319 * cp + 59486.9337812);

    if (cp < 381.73)
        return (-17.03267913 * cp + 3342.55947265) / (cp * cp - 360.8419732 * cp + 32568.5395889)
            + 0.995103;

    return (35073.0 * cp) / (755200.0 + 35014.0 * cp)
        + ((0.4182050082072 * cp - 2942.6269998574) / (cp * cp - 128.710949474 * cp - 6632.9691544526)) * Exp(-Pow((cp - 400.0) / 7000.0, 3))
        - 5.727639074137869e-8;
}

/**
 * Convert eval to win %
 * @param {number} eval_
 * @returns {number}
 */
function _leelaEvalToWinPct(eval_) {
    let q = Sign(eval_) * _leelaCpToQ(Abs(eval_) * 100);
    return Round(100 * 100 * q) / 200;
}

/**
 * Calculate the probability to draw or win
 * - works for AA and NN engines
 * @param {string} short_engine short engine name
 * @param {number} eval_
 * @returns {string}
 */
function calculate_probability(short_engine, eval_)
{
    if (isNaN(eval_))
        return eval_;

    let white_win,
        feature = ENGINE_FEATURES[short_engine];

    // adjust the score
    if (feature & 1) {
        if (feature & 2)
            white_win = _leelaEvalToWinPct(eval_);
        else
            white_win = (Math.atan((eval_ * 100) / 290.680623072) / 3.096181612 + 0.5) * 100 - 50;
    }
    else
        white_win = (50 - (100 / (1 + Pow(10, eval_/ 4))));

    // final output
    let reverse = 0;
    if (eval_ < 0)
    {
        reverse = 1;
        white_win = -white_win;
    }
    let win = parseFloat(Max(0, white_win * 2)).toFixed(1),
        draw = parseFloat(100 - Max(win, 0)).toFixed(1);

    return !win? `${draw}% D`: `${win}% ${reverse? 'B': 'W'} | ${draw}% D`;
}

/**
 * Calculate White and Black points
 * @param {string} text
 * @returns {Object}
 */
function calculate_score(text) {
    let black = 0,
        white = 0;

    for (let i = 0, length = text.length; i < length; i ++) {
        let char = text[i];
        if (char == '0')
            black ++;
        else if (char == '1')
            white ++;
        else if (char == '=') {
            black += 0.5;
            white += 0.5;
        }
    }

    return {w: white, b: black};
}

/**
 * Get the short name of an engine
 * @param {string} engine Stockfish 20200407DC
 * @returns {string} Stockfish
 */
function get_short_name(engine)
{
    if (!engine)
        return '';
    return engine.includes('Baron')? 'Baron': Split(engine)[0];
}

// BOARD
////////

/**
 * Create 4 boards
 * - should be done at startup since we want to see the boards ASAP
 */
function create_boards() {
    let keys = Keys(BOARDS),
        first = keys[0];

    keys.forEach(key => {
        let options = Assign({
                border: 2,
                hook: handle_board_events,
                id: `#${key}`,
                list: true,
                mode: 'html',
                size: 24,
            }, BOARDS[key]),
            xboard = new XBoard(options);

        xboard.initialise();
        xboard.resize(options.size * 8 + options.border * 2);
        xboards[key] = xboard;
    });

    board_target = xboards[first];
    update_board_theme();
}

/**
 * Reset all boards
 */
function reset_boards() {
    Keys(xboards).forEach(key => {
        xboards[key].reset();
    });
}

/**
 * Update the boards' theme
 */
function update_board_theme() {
    let board_theme = BOARD_THEMES[Y.board_theme],
        keys = Keys(BOARDS),
        first = keys[0],
        theme = Y.piece_theme,
        theme_ext = PIECE_TYPES[theme] || PIECE_TYPES._,
        theme_size = PIECE_SIZES[theme] || PIECE_SIZES._;

    Keys(xboards).forEach(key => {
        let is_first = (key == first);

        Assign(xboards[key], {
            colors: board_theme,
            dirty: 3,
            high_color: Y.highlight_color,
            high_delay: Y.highlight_delay,
            high_size: Y.highlight_size,
            notation: (is_first? Y.notation: Y.notation_pv)? 6: 0,
            smooth: is_first? Y.animate: Y.animate_pv,
            theme: theme,
            theme_ext: theme_ext,
            theme_size: theme_size,
        });

        xboards[key].render();
    });
}

// TABLES
/////////

/**
 * Analyse the crosstable data
 * - create table-stand + table-cross
 * @param {Object} data
 */
function analyse_crosstable(data) {
    if (!data)
        return;

    let cross_rows = [],
        dicos = data.Table,
        orders = data.Order,
        abbrevs = orders.map(name => dicos[name].Abbreviation),
        stand_rows = [];

    // 1) analyse all data => create rows for both tables
    for (let name of orders) {
        let dico = dicos[name],
            elo = dico.Rating,
            new_elo = Round(elo + dico.Elo),
            results = dico.Results;

        // cross
        let cross_row = {
            abbrev: Lower(dico.Abbreviation),
            engine: name,
            points: dico.Score,
            rank: dico.Rank,
        };
        abbrevs.forEach((abbrev, id) => {
            let games = results[orders[id]];
            if (games) {
                cross_row[abbrev] = games.Scores.map(game => {
                    let score = game.Result;
                    return ` <a class="${SCORE_NAMES[score]}">${(score > 0 && score < 1)? '½': score}</a>`;
                }).join('').slice(1);
            }
        });
        cross_rows.push(cross_row);

        // stand
        stand_rows.push({
            crashes: dico.Strikes,
            diff: `${new_elo - elo} [${new_elo}]`,
            elo: elo,
            engine: name,
            games: dico.Games,
            loss: `${dico.LossAsWhite + dico.LossAsBlack} [${dico.LossAsWhite}/${dico.LossAsBlack}]`,
            points: dico.Score,
            rank: dico.Rank,
            sb: dico.Neustadtl,
            wins: `${dico.WinsAsWhite + dico.WinsAsBlack} [${dico.WinsAsWhite}/${dico.WinsAsBlack}]`,
        });
    }

    update_table('stand', stand_rows);

    // 2) table-cross: might need to update the columns too
    let node = Id('table-cross'),
        new_columns = [...Split(TABLES.cross), ...abbrevs],
        scolumns = Array.from(A('th', node)).map(node => node.textContent).join('|'),
        snew_columns = new_columns.join('|');

    if (scolumns != snew_columns) {
        // make the extra columns the same size
        let extras = new_columns.slice(3),
            width = `${Floor(71 / (extras.length + 0.001))}%`,
            widths = [...['4%', '18%', '7%'], ...extras.map(() => width)],
            head = create_table_columns(new_columns, widths);
        HTML('thead', head, node);
        translate_node(node);
    }

    update_table('cross', cross_rows);
}

/**
 * Handle the seasons file
 */
function analyse_seasons(data) {
    let seasons = (data || {}).Seasons;
    if (!seasons)
        return;

    let rows = Keys(seasons).reverse().map(key => Assign({season: isNaN(key)? key: `Season ${key}`}, seasons[key]));
    update_table('season', rows);
}

/**
 * Handle tournament data
 * @param {Object} data
 */
function analyse_tournament(data) {
    // LS(data);
}

/**
 * Create a field for a table value
 * @param {string} text
 * @returns {string[]} field, value
 */
function create_field_value(text) {
    let items = text.split('=');
    if (items.length > 1)
        return [items[0], items.slice(1).join('=')];

    // startTime => start_time
    let lower = Lower(text.replace(/([a-z])([A-Z])/g, (_match, p1, p2) => `${p1}_${p2}`)),
        pos = lower.indexOf(' [');
    if (pos > 0)
        lower = lower.slice(0, pos);

    return [lower.replace(/[_() ./#-]+/g, '_').replace(/^_+|_+$/, ''), text];
}

/**
 * Create a Live table
 * - we don't want to recreate the table each time, that's why this creation will give a boost
 * @param {Node|string} node node or selector
 * @param {boolean} is_live live => has more info
 */
function create_live_table(node, is_live) {
    let html =
        '<vert class="live fastart">'
            + '<div class="live-basic">'
                + '<i class="engine" data-x="name"></i> <i data-x="eval"></i> [<i data-x="score"></i>]'
            + '</div>';

    if (is_live)
        html +=
            '<div class="live-more">'
                + '[D: <i data-x="depth"></i> | TB: <i data-x="tb"></i> | Sp: <i data-x="speed"></i> | N: <i data-x="node"></i>]'
            + '</div>';

    html +=
            '<div class="live-pv"></div>'
        + '</vert>';
    HTML(node, html);
}

/**
 * Create a table
 * @param {string[]} columns
 * @param {boolean=} add_empty add an empty row (good for table-view)
 * @returns {string}
 */
function create_table(columns, add_empty) {
    let html =
        '<table><thead>'
        + create_table_columns(columns)
        + '</thead><tbody>'
        + (add_empty? columns.map(column => `<td data-x="${create_field_value(column)[0]}">&nbsp;</td>`).join(''): '')
        + '</tbody></table>';

    return html;
}

/**
 * Create <th> columns to be used in a table
 * - used by create_table
 * - used when generating the dynamic Crosstable
 * @param {string[]} columns
 * @param {number[]=} widths optional width for each column
 * @returns {string}
 */
function create_table_columns(columns, widths) {
    return columns.map((column, id) => {
        let [field, value] = create_field_value(column),
            style = widths? ` style="width:${widths[id]}"`: '';
        return `<th${style} ${id? '': 'class="rounded" '}data-x="${field}" data-t="${value}"></th>`;
    }).join('');
}

/**
 * Create all the tables
 */
function create_tables() {
    // 1) normal tables
    Keys(TABLES).forEach(name => {
        let table = TABLES[name],
            html = create_table(Split(table), name == 'view');
        HTML(`#table-${name}`, html);
    });
    translate_node('body');

    // 2) live tables
    for (let node of LIVE_TABLES)
        create_live_table(node, node.includes('live'));

    // 3) mouse/touch scroll
    Events('.scroller', '!touchstart touchmove touchend', () => {});
    Events('.scroller', 'mousedown mouseenter mouseleave mousemove mouseup touchstart touchmove touchend', e => {
        touch_handle(e);
    }, {passive: false});
}

/**
 * Download live data when the graph is ready
 */
function download_live() {
    // evals
    download_table(`data.json?no-cache${Now()}`, null, data => {
        update_live_eval(data, 0);
    });
    download_table(`data1.json?no-cache${Now()}`, null, data => {
        update_live_eval(data, 1);
    });

    // live engines
    download_table('liveeval.json', null, data => {
        update_live_eval(data, 0);
    });
    download_table('liveeval1.json', null, data => {
        update_live_eval(data, 1);
    });
}

/**
 * Download static JSON for a table
 * + cache support = can load the data from localStorage if it was recent
 * @param {string} url url
 * @param {string=} name table name
 * @param {function=} callback
 * @param {boolean=} add_delta calculate time delta, and add it to the data
 * @param {boolean=} no_cache force to skip the cache
 * @param {boolean=} only_cache only load data if it's cached
 * @param {boolean=} show open the table after wards
 */
function download_table(url, name, callback, {add_delta, no_cache, only_cache, show}={}) {
    function _done(data, cached) {
        if (DEV.json & 1) {
            LS(`${url}:`);
            LS(data);
        }

        // if cached and table was already filled => skip
        if (cached) {
            let nodes = A(`#table-${name} tr`);
            if (nodes.length > 1)
                return;
        }

        // fill the table
        if (callback)
            callback(data);
        else if (name) {
            update_table(name, data);
            if (show)
                open_table(name);
        }
    }

    let key,
        timeout = CACHE_TIMEOUTS[name];

    if (!no_cache && timeout) {
        key = `table_${name}`;
        let cache = get_object(key);
        if (cache && (only_cache || cache.time < Now() + timeout)) {
            if (DEV.json & 1)
                LS(`cache found: ${key} : ${Now() - cache.time} < ${timeout}`);
            _done(cache.data, true);
            return;
        }
        else if (DEV.json & 1)
            LS(`no cache: ${key}`);
    }

    if (only_cache)
        return;

    // get the data
    Resource(url, (code, data, xhr) => {
        if (code != 200)
            return;

        let now = Now(true);
        if (data && add_delta) {
            let last_mod = new Date(xhr.getResponseHeader('last-modified'));
            data.delta = now - last_mod.getTime();
        }

        if (key) {
            save_storage(key, {data: data, time: Floor(now)});
            if (DEV.json & 1)
                LS(`cache saved: ${key}`);
        }
        _done(data, false);
    });
}

/**
 * Download static JSON files at startup
 * @param {boolean=} only_cache
 */
function download_tables(only_cache) {
    if (!only_cache) {
        download_pgn();
        download_live();
    }

    // tables
    let dico = {only_cache: only_cache};
    download_table('crosstable.json', 'cross', analyse_crosstable, dico);
    download_table('tournament.json', 'tour', analyse_tournament, dico);
    download_table('schedule.json', 'sched', null, dico);
}

/**
 * Set table-season events
 */
function set_season_events() {
    let table = Id('table-season');

    // expand/collapse
    C('.season', function() {
        let next = this.nextElementSibling;
        Toggle(next);
        Style('svg.down', `transform:${Visible(next)? 'rotate(-90deg)': 'none'}`, true, this);
    }, table);

    // open games
    C('a[data-u]', function() {
        let dico = {no_cache: true},
            name = this.dataset.u,
            prefix = `${HOST_ARCHIVE}/${name}`,
            prefix_lower = `${HOST_ARCHIVE}/${Lower(name)}`;

        download_table(`${prefix}_crash.xjson`, 'crash', null, dico);
        download_table(`${prefix}_Crosstable.cjson`, 'cross', analyse_crosstable, dico);
        download_table(`${prefix}_Enginerating.egjson`, null, null, dico);
        download_table(`${prefix}_Schedule.sjson`, 'game', null, Assign({show: true}, dico));
        // download_pgn();
    }, table);
}

/**
 * Show tables depending on the event type
 * @param {string} type
 */
function show_tables(type) {
    let is_cup = (type == 'cup'),
        parent = Id('tables'),
        target = is_cup? 'brak': 'stand';
    S('[data-x="brak"], [data-x="event"]', is_cup, parent);
    S('[data-x="cross"], [data-x="h2h"], [data-x="stand"]', !is_cup, parent);

    Class('div.tab', '-active', true, parent);
    Class(`[data-x="${target}"]`, 'active', true, parent);
    Hide('div.scroller', parent);
    Show(`#table-${target}`);
}

/**
 * Update a table by adding rows
 * @param {string} name
 * @param {Object[]} data
 * @param {boolean=} reset clear the table before adding data to it (seems like we always need true?)
 */
function update_table(name, rows, reset=true) {
    let last,
        data_x = SetDefault(table_data, Y.x, {}),
        data = SetDefault(data_x, name, []),
        is_cross = (name == 'cross'),
        // is_event = (name == 'event'),
        is_game = (name == 'game'),
        is_sched = (name == 'sched'),
        is_winner = (name == 'winner'),
        new_rows = [],
        nodes = [],
        table = Id(`table-${name}`),
        body = _('tbody', table),
        columns = Array.from(A('th', table)).map(node => node.dataset.x);

    // reset or append?
    if (reset) {
        HTML(body, '');
        data.length = 0;
    }

    if (!Array.isArray(rows))
        return;

    // process all rows
    rows.forEach((row, row_id) => {
        row = Assign({}, ...Keys(row).map(key => ({[create_field_value(key)[0]]: row[key]})));
        data.push(row);

        let vector = columns.map(key => {
            let class_ = '',
                td_class = '',
                value = row[key];

            if (value == undefined) {
                if (is_cross) {
                    if (row.abbrev == key)
                        td_class = 'void';
                    value = '';
                }
                else
                    value = '-';
            }

            // special cases
            switch (key) {
            case 'black':
                if (row.result == '0-1')
                    class_ = 'win';
                else if (row.result == '1-0')
                    class_ = 'loss';
                break;
            case 'download':
                value = `<a href="${HOST_ARCHIVE}/${value}"><i data-svg="download"></i></a>`;
                break;
            case 'engine':
            case 'runner':
            case 'winner':
                if (!is_winner) {
                    td_class = 'tal';
                    value = `<hori><img class="left-image" src="image/engine/${get_short_name(value)}.jpg"><div>${value}</div></hori>`;
                }
                break;
            case 'game':
                value = row_id + 1;
                // if (row.moves)
                //     value = `<a class="game">${value}</a>`;
                break;
            case 'name':
                class_ = 'loss';
                break;
            case 'score':
                if (is_winner)
                    value = value.replace(/-/g, '<br>- ').replace('Abandonded', '-');
                else {
                    let numbers = Split(row.gamesno || '', ',');
                    value = value.split('').map((item, id) => {
                        return ` <a class="${SCORE_NAMES[item]}" title="${numbers[id] || 0}">${item.replace('=', '½')}</a>`;
                    }).join('');
                }
                break;
            case 'season':
                td_class = 'mono';
                let lines = [`<a class="season">${value} <i data-svg="down"></i></a>`];
                if (row.sub) {
                    lines.push('<grid class="dn">');
                    for (let sub of row.sub.reverse())
                        lines.push(
                            `<a class="sub" data-u="${sub.abb}">${sub.menu}</a>`
                            + `<a href="${HOST_ARCHIVE}/${sub.abb}.pgn.zip"><i data-svg="download"></i></a>`
                        );
                    lines.push('</grid>');
                }
                value = lines.join('');
                break;
            case 'white':
                if (row.result == '1-0')
                    class_ = 'win';
                else if (row.result == '0-1')
                    class_ = 'loss';
                break;
            default:
                if (typeof(value) == 'string') {
                    if (is_cross && !td_class & key.length == 2)
                        td_class = 'mono';
                    else if (value.slice(0, 4) == 'http')
                        value = `<a href="${value}" class="url">${value}</a>`;
                }
            }

            if (class_)
                value = `<i class="${class_}">${value}</i>`;
            if (td_class)
                td_class = ` class="${td_class}"`;

            return `<td${td_class}>${value}</td>`;
        });

        // special case
        if (is_sched) {
            if (!last && nodes.length && !row.moves) {
                nodes[nodes.length - 1].classList.add('active');
                last = true;
            }
            if (row.white == players[0].name && row.black == players[1].name)
                new_rows.push(row);
        }

        let dico = (is_game || is_sched || name == 'h2h')? {class: 'pointer', 'data-g': row_id + 1}: null,
            node = CreateNode('tr', vector.join(''), dico);
        nodes.push(node);
    });

    InsertNodes(body, nodes);

    // add events
    if (is_sched)
        update_table('h2h', new_rows, reset);
    else if (name == 'season')
        set_season_events();

    C('tr[data-g]', function() {
        Class('tr.active', '-active', true, table);
        Class(this, 'active', true, table);
    }, table);

    update_svg(table);
    translate_node(table);

    // shortcuts
    let html = HTML(table);
    for (let id = 1; id <= 2 ; id ++)
        if (name == Y[`shortcut_${id}`])
            HTML(`#table-shortcut${id}`, html);
}

// BRACKETS
///////////

/**
 * Calculate the seeds
 * - assume the final will be 1-2 then work backwards
 * - support non power of 2 => 0 will be the 'skip' seed
 * @param {number} num_team
 */
function calculate_seeds(num_team) {
    let number = 2,
        nexts = [1, 2];

    while (number < num_team) {
        number *= 2;
        let seeds = [];
        for (let i = 0; i < number; i ++) {
            let value = (i % 2)? (number + 1 - seeds[i - 1]): nexts[Floor(i / 2)];
            seeds[i] = (value <= num_team)? value: 0;
        }
        nexts = seeds;
    }

    return nexts;
}

/**
 * Create the brackets
 * @param {Object} data
 */
function create_bracket(data) {
    // 1)
    window.event = data;
    let game = 1,
        lines = ['<hori class="fastart noselect">'],
        teams = data.teams,
        num_team = teams.length,
        number = num_team,
        round_results = data.results[0] || [],
        round = 0,
        seeds = calculate_seeds(num_team * 2);

    // assign seeds
    teams.forEach((team, id) => {
        team[0].seed = seeds[id * 2];
        team[1].seed = seeds[id * 2 + 1];
    });

    // 2) create each round
    while (number >= 1) {
        let name = ROUND_NAMES[number] || `Round of ${number * 2}`,
            nexts = [],
            number2 = (number == 1)? 2: number,
            results = round_results[round] || [];

        lines.push(
            '<vert class="rounds fstart h100">'
            + `<div class="round" data-t="${name}"></div>`
            + `<vert class="${number == 1? 'fcenter final': 'faround'} h100">`
        );
        for (let i = 0; i < number2; i ++) {
            let names = [0, 0],
                result = results[i] || [],
                scores = [0, 0],
                team = teams[i];

            if (team)
                team.forEach((item, id) => {
                    let class_ = '',
                        short = get_short_name(item.name);

                    if (result[0] != result[1])
                        class_ = (item.winner && result[id] > result[1 - id])? ' win': ' loss';

                    names[id] = [
                        class_,
                        `<hori title="${item.name}"><img class="match-logo" src="image/engine/${short}.jpg"><div>#${item.seed} ${short}</div></hori>`,
                    ];
                    scores[id] = [
                        class_,
                        result[id],
                    ];

                    // propagate the winner to the next round
                    if (class_ == ' win')
                        SetDefault(nexts, Floor(i / 2), [{}, {}])[i % 2] = item;
                    // match for 3rd place
                    else if (class_ == ' loss' && number == 2)
                        SetDefault(nexts, 1, [{}, {}])[i % 2] = item;
                });

            lines.push(
                '<vert class="match fastart">'
                    // final has 3rd place game too
                    + `<div class="match-title">#${game + (number == 1? 1 - i * 2: 0)}</div>`
                    + '<grid class="match-grid">'
            );

            for (let id = 0; id < 2; id ++) {
                let [name_class, name] = names[id] || [],
                    [score_class, score] = scores[id] || [];

                if (!name) {
                    name = 'TBD';
                    score = '--';
                    name_class = ' none';
                    score_class = ' none';
                }
                else
                    name_class += ' fastart';

                lines.push(
                    `<vert class="name${name_class} fcenter">${name}</vert>`
                    + `<vert class="score${score_class} fcenter">${score}</vert>`
                );
            }

            lines.push(
                    '</grid>'
                + '</vert>'
            );
            game ++;
        }
        lines.push(
                '</vert>'
            + '</vert>'
        );

        number /= 2;
        round ++;
        teams = nexts;
    }

    // 3) result
    lines.push('</hori>');
    let node = Id('table-brak');
    HTML(node, lines.join(''));
    translate_node(node);

    // necessary to correctly size each round
    Style(node.firstChild, `height:${node.clientHeight}px`);
}

/**
 * Create a cup
 * @param {Object} data
 */
function create_cup(data) {
    show_tables('cup');

    let event = data.EventTable;
    if (event) {
        let rows = Keys(event).map(key => {
            return Assign({round: key.split(' ').slice(-1)}, event[key]);
        });
        update_table('event', rows);
    }

    create_bracket(data);
}

// PGN
//////

/**
 * Check the adjudication
 * @param {Object} dico
 * @param {number} total_moves
 * @returns {Object} 50, draw, win
 */
function check_adjudication(dico, total_moves) {
    if (!dico)
        return {};
    let _50 = dico.FiftyMoves,
        abs_draw = Abs(dico.Draw),
        abs_win = Abs(dico.ResignOrWin);

    return {
        50: (_50 < 51)? _50: '-',
        draw: (abs_draw <= 10 && total_moves > 58)? `${Max(abs_draw, 69 - total_moves)}p`: '-',
        win: (abs_win < 11)? abs_win: '-',
    };
}

/**
 * Download the PGN
 */
function download_pgn() {
    Resource(`live.json?no-cache${Now()}`, (code, data, xhr) => {
        if (code != 200)
            return;

        if (data) {
            let last_mod = new Date(xhr.getResponseHeader('last-modified'));
            data.elapsed = Now(true) - last_mod.getTime() / 1000;
            data.gameChanged = 1;
        }

        pgn = null;
        update_pgn(data);
    });
}

/**
 * Update engine info from a move
 * @param {number} ply
 * @param {Move} move
 * @param {boolean=} fresh is it the latest move?
 */
function update_move_info(ply, move, fresh) {
    let is_book = move.book,
        eval_ = is_book? 'book': move.wv,
        id = ply % 2,
        stats = {
            depth: is_book? '-': `${move.d}/${move.sd}`,
            eval: eval_,
            node: is_book? '-': FormatUnit(move.n),
            speed: is_book? '-': `${FormatUnit(move.s)}bps`,
            tb: is_book? '-': FormatUnit(move.tb),
        };

    Keys(stats).forEach(key => {
        HTML(`#${key}${id}`, stats[key]);
    });

    if (fresh)
        Assign(players[id], {
            elapsed: 0,
            eval: eval_,
            left: move.tl * 1,
            time: move.mt * 1,
        });

    update_clock(id);
}

/**
 * Update PV info from a player move
 * @param {number} ply
 * @param {Move} move
 */
function update_move_pv(ply, move) {
    let is_book = move.book,
        eval_ = is_book? 'book': move.wv,
        id = ply % 2,
        board = xboards[`pv${id}`],
        node = Id(`player${id}`);

    HTML(`[data-x="eval"]`, is_book? '': move.wv, node);
    HTML(`[data-x="score"]`, is_book? 'book': calculate_probability(players[id].short, eval_), node);
    // LS(move.pv);
    // HTML('.live-pv', create_live_pv(ply, move.pv? move.pv.San: ''), node);

    if (move.pv) {
        let temp = board.smooth;
        board.smooth = false;
        board.reset();
        board.add_moves(move.pv.Moves, ply);
        board.smooth = temp;
    }
}

/**
 * Update the PGN
 * - white played => lastMoveLoaded=109
 * @param {Object} pgn_
 */
function update_pgn(pgn_) {
    if (!xboards.board)
        return;
    pgn = pgn_;
    window.pgn = pgn;

    let headers = pgn.Headers,
        moves = pgn.Moves,
        new_game = pgn.gameChanged,
        num_move = moves.length,
        overview = Id('table-view'),
        start = pgn.lastMoveLoaded || 0;

    // 1) update overview
    // TODO: only change these when a new game was detected?
    if (pgn.Users)
        HTML('td[data-x="viewers"]', pgn.Users, overview);
    if (headers) {
        Split('ECO|Event|Opening|Result|Round|TimeControl').forEach(key => {
            let value = headers[key];
            if (value == undefined)
                value = '';

            // TCEC Season 17 => S17
            if (key == 'Event')
                value = value.replace('TCEC Season ', 'S');
            else if (key == 'TimeControl') {
                let items = value.split('+');
                key = 'tc';
                value = `${items[0]/60}'+${items[1]}"`;
            }
            HTML(`td[data-x="${Lower(key)}"]`, value, overview);
        });
    }

    if (new_game) {
        LS(`new pgn: ${headers.Round}`);
        pgn.gameChanged = 0;
    }

    if (!num_move)
        return;

    // 2) update the moves
    let board = xboards.board,
        move = moves[num_move - 1],
        last_ply = (pgn.numMovesToSend || moves.length) + start;

    // new game?
    if (prev_round != headers.Round || !last_ply || last_ply < num_ply) {
        LS(`new game: ${prev_round} => ${headers.Round} : last_ply=${last_ply} : num_ply=${num_ply}`);
        reset_boards();
        reset_charts();
        prev_round = headers.Round;
    }

    board.add_moves(moves, start);
    update_player_chart(null, moves, start);
    if (Y.move_sound)
        play_sound(audiobox, 'move', {ext: 'mp3', interrupt: true});

    // 3) check adjudication + update overview
    let tb = Lower(move.fen.split(' ')[0]).split('').filter(item => 'bnprqk'.includes(item)).length - 6;
    HTML('td[data-x="tb"]', tb, overview);

    let finished = headers.TerminationDetails,
        result = check_adjudication(move.adjudication, num_ply);
    result.adj_rule = finished;
    Keys(result).forEach(key => {
        HTML(`td[data-x="${key}"]`, result[key], overview);
    });

    S('[data-x="adj_rule"]', finished, overview);
    S('[data-x="50"], [data-x="draw"], [data-x="win"]', !finished, overview);
    if (finished) {
        let result = headers.Result;
        if (Y.crowd_sound)
            play_sound(audiobox, (result == '1/2-1/2')? 'draw': 'win');
        board.set_last(result);
    }

    // 4) clock
    // num_ply % 2 tells us who plays next
    num_ply = board.moves.length;
    let who = num_ply % 2;
    start_clock(who, finished);

    // time control could be different for white and black
    let tc = headers[`${WB_TITLES[who]}TimeControl`];
    if (tc) {
        let items = tc.split('+');
        HTML(`td[data-x="tc"]`, `${items[0]/60}'+${items[1]}"`, overview);
    }

    // 5) engines
    WB_TITLES.forEach((title, id) => {
        let name = headers[title],
            node = Id(`player${id}`),
            short = get_short_name(name),
            src = `image/engine/${short}.jpg`;

        Assign(players[id], {
            name: name,
            short: short,
        });

        HTML(`#engine${id}`, name);
        HTML(`[data-x="name"]`, short, node);
        HTML(`#score${id}`, headers[`${title}Elo`]);

        let image = Id(`logo${id}`);
        if (image.src != src) {
            image.setAttribute('alt', name);
            image.src = src;
        }
    });

    for (let i = num_move - 1; i>=0 && i >= num_move - 2; i --) {
        let move = moves[i];
        update_move_info(start + i, move, true);
        update_move_pv(start + i, move);
    }

    // material
    let material = move.material,
        materials = [[], []];
    if (material) {
        'qrbnp'.split('').forEach(key => {
            let value = material[key];
            if (value) {
                let id = (value > 0)? 0: 1,
                    color = id? 'b': 'w';
                for (let i = 0; i < Abs(value); i ++)
                    materials[id].push(`<div><img src="theme/wikipedia/${color}${Upper(key)}.svg"></div>`);
            }
        });

        for (let id = 0; id < 2; id ++) {
            let node = Id(`material${id}`),
                html = HTML(node),
                material = materials[id].join('');
            if (html != material)
                HTML(node, material);
        }
    }
}

/**
 * Resize game elements
 */
function resize_game() {
    // resize the boards
    for (let [parent, key] of [['left', 'board']]) {
        let width = Id(parent).clientWidth,
            board = xboards[key];
        if (board) {
            board.smooth = false;
            board.resize(width);
            add_timeout('smooth', () => {board.smooth = Y.animate;}, 100);
        }
    }

    resize_3d();
}

// LIVE ACTION/DATA
///////////////////

/**
 * Clock countdown
 * @param {number} id
 */
function clock_tick(id) {
    let now = Now(true),
        player = players[id],
        elapsed = (now - player.start) * 1000,
        left = player.left - elapsed,
        // try to synchronise it with the left time
        timeout = Floor(left) % 1000 - 1;

    if (isNaN(timeout))
        return;

    if (timeout < 50)
        timeout += 100;

    player.elapsed = elapsed;
    update_clock(id);
    add_timeout(`clock${id}`, () => {clock_tick(id, now);}, timeout);
}

/**
 * Create a live PV from a string
 * @param {number} ply starting ply
 * @param {string} pv
 * @returns {string} html
 */
function create_live_pv(ply, text) {
    if (!text)
        return '';

    let items = text.replace('...', '... ').split(' ').map(item => {
        if (item.slice(-1) == '.')
            return '';

        let line = '';
        if (ply % 2 == 0)
            line = `<i class="turn">${1 + ply / 2} </i>`;

        line += `<a class="real">${item} </a>`;
        ply ++;
        return line;
    });

    return items.join('');
}

/**
 * Set the number of viewers
 * @param {number} count
 */
function set_viewers(count) {
    HTML('#table-view td[data-x="viewers"]', count);
}

/**
 * Start the clock for one player, and stop it for the other
 * @param {number} id
 * @param {boolean=} finished game is over => both clocks will stop
 */
function start_clock(id, finished) {
    S(`#cog${id}`, !finished);
    Hide(`#cog${1 - id}`);

    clear_timeout('clock0');
    clear_timeout('clock1');
    if (!finished) {
        players[id].start = Now(true);
        clock_tick(id);
    }
}

/**
 * Update data from one of the Live engines
 * @param {Object} data
 * @param {number} id 0, 1
 */
function update_live_eval(data, id) {
    if (!data)
        return;

    let moves = data.moves;
    // moves => maybe old data?
    if (moves) {
        if (data.round != prev_round) {
            LS(`maybe old data => SKIP: ${data.round} vs ${prev_round}`);
            return;
        }
        data = moves[moves.length - 1];
    }

    let eval_ = data.eval,
        short = get_short_name(data.engine),
        node = Id(`table-live${id}`);

    // live engine is not desired?
    if (!Y[`live_engine_${id + 1}`]) {
        HTML(`[data-x="name"]`, short, node);
        HTML('.live-pv', `<i>${translate('off')}</i>`, node);
        return;
    }

    let dico = {
        depth: data.depth,
        eval: eval_,
        name: short,
        node: FormatUnit(data.nodes),
        score: calculate_probability(short, eval_),
        speed: data.speed,
        tb: FormatUnit(data.tbhits),
    };
    Keys(dico).forEach(key => {
        HTML(`[data-x="${key}"]`, dico[key], node);
    });

    HTML('.live-pv', create_live_pv(num_ply - id, data.pv), node);
    update_live_chart(moves || [data], id + 2);
}

/**
 * Update data from a Player
 * @param {Object} data
 */
function update_player_eval(data) {
    let eval_ = data.eval,
        id = data.color,
        board = xboards[`pv${id}`],
        node = Id(`player${id}`),
        short = get_short_name(data.engine);

    // 1) update the live part on the left
    let dico = {
        eval: eval_,
        name: short,
        score: calculate_probability(short, eval_),
    };
    Keys(dico).forEach(key => {
        HTML(`[data-x="${key}"]`, dico[key], node);
    });

    // TODO: handle this better ...
    HTML('.live-pv', create_live_pv(num_ply - id, data.pv), node);
    // LS(data);
    // board.reset();
    // board.add_moves(data.pv, num_ply);

    // 2) update the engine info in the center
    let stats = {
        depth: data.depth,
        engine: data.engine,
        eval: eval_,
        logo: short,
        node: FormatUnit(data.nodes),
        speed: data.speed,
        tb: FormatUnit(data.tbhits),
    };
    Keys(stats).forEach(key => {
        HTML(`#${key}${id}`, stats[key]);
    });

    update_live_chart([data], id);
}

/**
 * Update the left + time UI info
 */
function update_clock(id) {
    let player = players[id],
        elapsed = player.elapsed,
        left = player.left,
        time = player.time;

    left = left? FromSeconds(Round((left - elapsed) / 1000)).slice(0, -1).map(item => Pad(item)).join(':'): 'n/a';
    time = time? FromSeconds(Round((time + elapsed) / 1000)).slice(1, -1).map(item => Pad(item)).join(':'): 'n/a';
    HTML(`#left${id}`, left);
    HTML(`#time${id}`, time);
}

// INPUT / OUTPUT
/////////////////

/**
 * Handle keys, when input is not active
 * @param {number} code hardware keycode
 * @param {Object=} active active input element, if any
 */
function action_key_no_input(code, active) {
}

/**
 * Handle keys, when input is not active
 * @param {number} code hardware keycode
 */
function game_action_key(code) {
    if (Visible('#overlay')) {
        let changes = 0,
            parent = Visible('#modal')? Id('modal'): Id('modal2'),
            items = Array.from(A('.item', parent)).filter(item => Visible(item)),
            length = items.length,
            index = (items.findIndex(item => HasClass(item, 'selected')) + length) % length,
            node = items[index],
            tag = node.tagName,
            is_grid = HasClass(node.parentNode, 'grid');

        switch (code) {
        // escape, e
        // case 27:
        case 69:
            LS(`game_action_key: ${code}`);
            if (Visible('#modal2'))
                show_modal(true);
            else
                resume_game();
            break;
        // enter, space, x
        case 13:
        case 32:
        case 83:
            node.click();
            break;
        // left
        case 37:
            if (tag == 'DIV' && is_grid) {
                node = node.nextElementSibling;
                tag = node.tagName;
            }
            if (tag == 'SELECT') {
                node.selectedIndex = (node.selectedIndex - 1 + node.options.length) % node.options.length;
                changes ++;
            }
            else if (tag == 'INPUT') {
                let min = parseInt(node.min);
                if (isNaN(min) || node.value > min) {
                    node.value --;
                    changes ++;
                }
            }
            break;
        // up
        case 38:
            index = (index - 1 + length) % length;
            break;
        // right
        case 39:
            if (tag == 'DIV' && is_grid) {
                node = node.nextElementSibling;
                tag = node.tagName;
            }
            if (tag == 'SELECT') {
                node.selectedIndex = (node.selectedIndex + 1) % node.options.length;
                changes ++;
            }
            else if (tag == 'INPUT') {
                let max = parseInt(node.max);
                if (isNaN(max) || node.value < max) {
                    node.value ++;
                    changes ++;
                }
            }
            break;
        // down
        case 40:
            index = (index + 1) % length;
            break;
        }

        // changed a setting?
        if (changes && node.name)
            change_setting(node.name, node.value);

        // moved?
        Class('.selected', '-selected', true, parent);
        Class(items[index], 'selected');
    }
    else {
        switch (code) {
        // enter, space
        case 13:
        case 32:
            break;
        // escape
        case 27:
            // LS(`game_action_key2: ${code}`);
            // show_menu();
            break;
        // left
        case 37:
            board_target.go_prev();
            break;
        // right
        case 39:
            board_target.go_next();
            break;
        }
    }
}

/**
 * Handle a keyup
 * @param {number} code
 */
function game_action_keyup(code) {
    // LS(`keyup: ${code}`);
}

// 3D SCENE
///////////

/**
 * Initialise the 3D engine
 */
function init_3d_special() {
    load_model('pieces', 'export/pieces-draco.glb', object => {
        cube = object;
        scene.add(cube);
    });
}

/**
 * Random position for looking at the chessboard
 */
function random_position() {
    return {x: -1.34, y: -1.98, z: 0.97};
}

// EVENTS
/////////

/**
 * Handle xboard events
 * @param {XBoard} board
 * @param {string} type
 * @param {Event|string} value
 */
function handle_board_events(board, type, value) {
    switch (type) {
    case 'activate':
        board_target = board;
        break;
    // controls: play, next, ...
    case 'control':
        board_target = board;
        if (value == 'cube') {
            board.mode = (board.mode == 'html')? 'text': 'html';
            board.render(3);
        }
        break;
    // move list => ply selected
    case 'move':
        board_target = board;
        let target = value.target,
            id = target.dataset.i;
        if (id != undefined)
            board.set_ply(id * 1);
        break;
    // ply was set => maybe update some stats (for the main board)
    case 'ply':
        if (board.id == '#board') {
            let ply = board.ply;
            update_move_info(ply, value);
            add_timeout(`ply_live${ply % 2}`, () => {update_move_pv(ply, value);}, TIMEOUT_PLY_LIVE);
        }
        break;
    }
}

/**
 * Select a tab and open the corresponding table
 * @param {string|Node} sel tab name or node
 * @param {boolean=} hide_table hide the corresponding table (but PV is shared!)
 */
function open_table(sel, hide_table=true) {
    if (typeof(sel) == 'string')
        sel = _(`div.tab[data-x="${sel}"]`);

    let parent = Parent(sel, 'horis', 'tabs'),
        active = _('div.active', parent),
        key = sel.dataset.x,
        node = Id(`table-${key}`);

    Class(active, '-active');
    Class(sel, 'active');
    if (hide_table)
        Hide(`#table-${active.dataset.x}`);
    Show(node);

    opened_table(node, key, sel);
}

/**
 * Special handling after user clicked on a tab
 * @param {Node} node table node
 * @param {string} name
 * @param {Node} tab
 */
function opened_table(node, name, tab) {
    // 1) save the tab
    let parent = Parent(tab),
        is_chart = (parent.id == 'chart-tabs');
    if (DEV.ui)
        LS(`opened_table: ${parent.id}/${name}`);

    Y.tabs[parent.id] = name;
    save_option('tabs', Y.tabs);

    // 2) special cases
    if (is_chart && CHART_NAMES[name] && xboards.board)
        update_player_chart(name, xboards.board.moves, 0);

    switch (name) {
    case 'crash':
        download_table('crash.json', name);
        break;
    case 'info':
        HTML(node, HTML('#desc'));
        break;
    case 'log':
        listen_log();
        break;
    // change order + switch to default tab
    case 'pv':
        Style('#table-pv', `order:${is_chart? 3: 1}`);
        if (is_chart)
            open_table('engine', false);
        else {
            let active = _('#chart-tabs .active');
            if (active && active.dataset.x == 'pv')
                open_table('eval', false);
        }
        break;
    case 'season':
        download_table('gamelist.json', name, analyse_seasons);
        break;
    case 'winner':
        download_table('winners.json', name);
        break;
    }

    if (virtual_opened_table_special)
        virtual_opened_table_special(node, name, tab);
}

/**
 * Show a popup with the engine info
 * @param {string} scolor white, black
 * @param {Event} e
 */
function popup_engine_info(scolor, e) {
    if (!pgn)
        return;

    let show,
        popup = Id('popup'),
        type = e.type;

    if (type == 'mouseleave')
        show = false;
    else if (scolor == 'popup')
        show = true;
    else {
        let title = Title(scolor),
            engine = Split(pgn.Headers[title]),
            options = pgn[`${title}EngineOptions`],
            lines = options.map(option => [option.Name, option.Value]);

        // add engine + version
        lines.splice(0, 0, ['Engine', engine[0]], ['Version', engine.slice(1).join(' ')]);
        lines = lines.flat().map(item => `<div>${item}</div>`);

        HTML(popup, `<grid class="grid2">${lines.join('')}</grid>`);

        // place the popup in a visible area on the screen
        let x = e.clientX + 10,
            y = e.clientY + 10,
            x2 = 0,
            y2 = 0;
        if (x >= window.innerWidth / 2) {
            x -= 20;
            x2 = -100;
        }
        if (y >= window.innerHeight / 2) {
            y -= 20;
            y2 = -100;
        }

        Style(popup, `transform:translate(${x}px,${y}px) translate(${x2}%, ${y2}%)`);
        show = true;
    }

    Class(popup, 'popup-show', show);
    // trick to be able to put the mouse on the popup and copy text
    if (show) {
        clear_timeout('popup-engine');
        Class(popup, 'popup-enable');
    }
    else
        add_timeout('popup-engine', () => {Class(popup, '-popup-enable');}, 500);
}

/**
 * Game events
 */
function set_game_events() {
    set_3d_events();

    // engine popup
    Events('#info0, #info1', 'click mouseenter mousemove mouseleave', function(e) {
        popup_engine_info(WHITE_BLACK[this.id.slice(-1)], e);
    });

    // tabs
    C('div.tab', function() {
        open_table(this);
    });
}

// STARTUP
//////////

/**
 * Call this after the structures have been initialised
 */
function start_game() {
    create_tables();
    create_boards();
    show_tables('league');
    // download_table('bracket.json', 'brak', create_cup);
}

/**
 * Initialise structures with game specific data
 */
function startup_game() {
    //
    Assign(DEFAULTS, {
        order: 'left|center|right',         // main panes order
        tabs: {},                           // opened tabs
        three: 0,
        twitch_chat: 1,
        twitch_dark: 1,
        twitch_video: 1,
    });

    let shortcuts = [...['off'], ...Keys(TABLES)];

    merge_settings({
        // separator
        _1: {},
        board: {
            animate: [ON_OFF, 1],
            arrow_opacity: [{max: 1, min: 0, step: 0.01, type: 'number'}, 0.5],
            board_theme: [Keys(BOARD_THEMES), 'chess24'],
            highlight_color: [{type: 'color'}, '#ffff00'],
            highlight_delay: [{max: 1500, min: -100, step: 100, type: 'number'}, 1100],
            highlight_size: [{max: 0.5, min: 0, step: 0.01, type: 'number'}, 0.06],
            notation: [ON_OFF, 1],
            piece_theme: [PIECE_KEYS, 'chess24'],
            play_every: [{max: 5000, min: 100, step: 100, type: 'number'}, 1000],
        },
        board_pv: {
            animate_pv: [ON_OFF, 1],
            live_pv: [ON_OFF, 1],
            notation_pv: [ON_OFF, 1],
            ply_diff: [['first', 'diverging', 'last'], 'first'],
        },
        live: {
            live_engine_1: [ON_OFF, 1],
            live_engine_2: [ON_OFF, 2],
            live_log: [[0, 5, 10, 'all'], 0],
        },
        extra: {
            cross_crash: [ON_OFF, 0],
            shortcut_1: [shortcuts, 'stand'],
            shortcut_2: [shortcuts, 'off'],
        },
    });

    virtual_init_3d_special = init_3d_special;
    virtual_random_position = random_position;
}
