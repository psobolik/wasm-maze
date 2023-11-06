pub mod player;
mod utils;
mod wasm_maze;

use wasm_bindgen::prelude::*;

use crate::utils::set_panic_hook;
use crate::wasm_maze::WasmMaze;

#[wasm_bindgen]
pub struct MazeEngine {
    columns: u32,
    rows: u32,
    maze: WasmMaze,
    context: web_sys::CanvasRenderingContext2d,
}

#[wasm_bindgen]
impl MazeEngine {
    pub fn new(columns: u32, rows: u32, canvas_id: &str) -> MazeEngine {
        let maze = WasmMaze::new(columns, rows);
        let context = MazeEngine::get_context_element(canvas_id);
        maze.init(&context);
        maze.draw(&context);

        MazeEngine {
            columns,
            rows,
            maze,
            context,
        }
    }

    pub fn change_maze(&mut self, columns: u32, rows: u32) {
        let maze = WasmMaze::new(columns, rows);
        maze.init(&self.context);
        self.maze = maze;
        self.columns = columns;
        self.rows = rows;
        self.draw_maze();
    }

    pub fn draw_maze(&self) {
        self.maze.draw(&self.context);
    }

    pub fn move_player_north(&mut self) -> bool {
        if self.maze.move_player_north() {
            self.maze.draw(&self.context);
            return true;
        }
        false
    }

    pub fn move_player_east(&mut self) -> bool {
        if self.maze.move_player_east() {
            self.maze.draw(&self.context);
            return true;
        }
        false
    }

    pub fn move_player_south(&mut self) -> bool {
        if self.maze.move_player_south() {
            self.maze.draw(&self.context);
            return true;
        }
        false
    }

    pub fn move_player_west(&mut self) -> bool {
        if self.maze.move_player_west() {
            self.maze.draw(&self.context);
            return true;
        }
        false
    }

    pub fn is_won(&self) -> bool {
        self.maze.is_won()
    }

    fn get_context_element(id: &str) -> web_sys::CanvasRenderingContext2d {
        set_panic_hook();

        let window = web_sys::window().expect("should be a global `window`");
        let document = window.document().expect("window should have a document");
        let canvas = document
            .get_element_by_id(id)
            .expect("document should have an element with ID 'canvas'");

        let canvas: web_sys::HtmlCanvasElement = canvas
            .dyn_into::<web_sys::HtmlCanvasElement>()
            .map_err(|_| ())
            .expect("element with ID 'canvas' should be an HTML canvas element");

        canvas
            .get_context("2d")
            .unwrap()
            .unwrap()
            .dyn_into::<web_sys::CanvasRenderingContext2d>()
            .expect("HTML canvas element should have a 2D context")
    }
}

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);
}
