import * as wasm from "../pkg/wasm_maze";

const min_size = 10;
const max_size = 50;
const default_size = 20;

let award_index = 0;
const awards = ['🥇','🏆','👍','🎉'];

setup_input('columns');
setup_input('rows');

const maze_engine = wasm.MazeEngine.new(get_columns(), get_rows(), "canvas");

document.body.addEventListener('keyup', player_keyup_handler);
document
    .getElementById('reset')
    .addEventListener('click', reset);

function player_keyup_handler(event) {
    switch (event.key) {
        case "ArrowUp":
            if (maze_engine.move_player_north())
                check_win();
            break;
        case "ArrowRight":
            if (maze_engine.move_player_east())
                check_win();
            break;
        case "ArrowDown":
            if (maze_engine.move_player_south())
                check_win();
            break;
        case "ArrowLeft":
            if (maze_engine.move_player_west())
                check_win();
            break;
    }
}

function win_keyup_handler(event) {
    if (!event.key in ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"])
        reset();
}
function reset() {
    document.getElementById('success').classList.remove('success');

    document.body.removeEventListener('keyup', win_keyup_handler);
    document.body.removeEventListener('mouseup', reset);
    document.body.removeEventListener('keyup', player_keyup_handler);
    maze_engine.change_maze(get_columns(), get_rows());
    document.body.addEventListener('keyup', player_keyup_handler);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function get_columns() {
    return clamp(Number(document.getElementById('columns').value), min_size, max_size);
}

function get_rows() {
    return clamp(Number(document.getElementById('rows').value), min_size, max_size);
}

function check_win() {
    if (maze_engine.is_won()) {
        document.body.removeEventListener('keyup', player_keyup_handler);
        document.body.addEventListener('keyup', win_keyup_handler);
        document.body.addEventListener('mouseup', reset);
        const success = document.getElementById('success');
        // Rotate "award"
        const award = awards[award_index];
        award_index = (award_index + 1) % 4;
        success.innerText = `${award}\xa0SUCCESS!\xa0${award}`
        success.classList.add('success');
    }
}

function setup_input(id) {
    const element = document.getElementById(id);
    element.min = min_size;
    element.max = max_size;
    element.value = default_size;
    element.addEventListener('change', () => {
        element.value = clamp(element.value, element.min, element.max);
    })
}