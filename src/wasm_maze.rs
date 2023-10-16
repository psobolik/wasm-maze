use maze_lib::maze_generator;
use maze_lib::maze::Maze;
use maze_lib::maze::cell_edge::CellEdge;
use maze_lib::maze::coordinates::Coordinates;
use maze_lib::maze::direction::Direction;

use crate::player::Player;
use std::convert::Into;

pub struct CanvasPoints {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug)]
pub struct WasmMaze {
    columns: u32,
    rows: u32,
    maze: Maze,
    player: Player,
    goal: Coordinates,
}

impl WasmMaze {
    const CELL_WIDTH: f64 = 30.0;
    const BORDER_LINE_WIDTH: f64 = 5.0;
    const BORDER_STROKE_STYLE: &'static str = "rgb(20, 55, 20)";
    const WALL_LINE_WIDTH: f64 = 3.0;
    const WALL_STROKE_STYLE: &'static str = "rgb(20, 55, 20)";
    const GRID_STROKE_STYLE: &'static str = "rgb(255, 255, 255)";
    const GRID_FILL_STYLE: &'static str = "rgb(210, 210, 230)";
    const GOAL_STROKE_STYLE: &'static str = "rgb(255, 255, 64)";
    const GOAL_FILL_STYLE: &'static str = "rgb(255, 0, 0)";
    const PLAYER_STROKE_STYLE: &'static str = "rgb(25, 0, 0)";
    const PLAYER_FILL_STYLE: &'static str = "rgb(255, 255, 0)";

    pub fn new(columns: u32, rows: u32) -> WasmMaze {
        WasmMaze {
            columns,
            rows,
            maze: maze_generator::generate(columns, rows),
            player: Player::new_with_column_and_row(
                WasmMaze::CELL_WIDTH,
                0,
                rows - 1,
                WasmMaze::PLAYER_STROKE_STYLE.into(),
                WasmMaze::PLAYER_FILL_STYLE.into(),
            ),
            goal: Coordinates::new((columns - 1) as i32, 0i32),
        }
    }

    pub fn maze_width(&self) -> f64 {
        self.columns as f64 * WasmMaze::CELL_WIDTH
    }

    pub fn maze_height(&self) -> f64 {
        self.rows as f64 * WasmMaze::CELL_WIDTH
    }

    fn offset(&self) -> f64 {
        WasmMaze::CELL_WIDTH / 2.0
    }

    fn canvas_coordinates(&self, coordinates: &Coordinates) -> CanvasPoints {
        let column = coordinates.column() as f64;
        let row = coordinates.row() as f64;
        let bottom = row * WasmMaze::CELL_WIDTH;
        let left = column * WasmMaze::CELL_WIDTH;
        let right = left + WasmMaze::CELL_WIDTH;
        let top = bottom + WasmMaze::CELL_WIDTH;
        CanvasPoints {
            top,
            right,
            bottom,
            left,
        }
    }

    pub fn init(&self, context: &web_sys::CanvasRenderingContext2d) {
        if let Some(canvas) = context.canvas() {
            canvas.set_width(self.columns * (WasmMaze::CELL_WIDTH as u32));
            canvas.set_height(self.rows * (WasmMaze::CELL_WIDTH as u32));
        }
    }

    pub fn draw(&self, context: &web_sys::CanvasRenderingContext2d) {
        self.draw_grid(context);
        self.draw_maze(context);
        self.draw_player(context);
        self.draw_goal(context);
    }

    fn draw_grid(&self, context: &web_sys::CanvasRenderingContext2d) {
        context.save();
        context.set_fill_style(&WasmMaze::GRID_FILL_STYLE.into());
        context.fill_rect(0.0, 0.0, self.maze_width(), self.maze_height());

        context.begin_path();
        context.set_stroke_style(&WasmMaze::GRID_STROKE_STYLE.into());

        let mut x = -self.offset();
        let mut y = 0.0;
        for _i in 0..self.columns {
            x += WasmMaze::CELL_WIDTH;
            context.move_to(x, y);
            context.line_to(x, self.maze_height());
        }

        x = 0.0;
        y = -self.offset();
        for _i in 0..self.rows {
            y += WasmMaze::CELL_WIDTH;
            context.move_to(x, y);
            context.line_to(self.maze_width(), y);
        }
        context.stroke();
        context.restore();
    }

    fn draw_maze(&self, context: &web_sys::CanvasRenderingContext2d) {
        fn draw_line(
            context: &web_sys::CanvasRenderingContext2d,
            start_x: f64,
            start_y: f64,
            end_x: f64,
            end_y: f64,
            style: &str,
            width: f64
        ) {
            context.begin_path();
            context.move_to(start_x, start_y);
            context.line_to(end_x, end_y);
            context.set_stroke_style(&style.into());
            context.set_line_width(width);
            context.stroke();
        }
        context.save();
        context.set_line_cap("round");
        for cell in (&self.maze).into_iter().flatten() {
            let canvas_coordinates = self.canvas_coordinates(&cell.coordinates());
            // We draw all borders, but only the East and South walls
            if cell.edge(&Direction::North).unwrap() == CellEdge::Border {
                draw_line(context,
                          canvas_coordinates.left,
                          canvas_coordinates.top,
                          canvas_coordinates.right,
                          canvas_coordinates.top,
                          WasmMaze::BORDER_STROKE_STYLE,
                          WasmMaze::BORDER_LINE_WIDTH);
            }
            match cell.edge(&Direction::East) {
                Some(CellEdge::Wall) => {
                    draw_line(context,
                              canvas_coordinates.right,
                              canvas_coordinates.top,
                              canvas_coordinates.right,
                              canvas_coordinates.bottom,
                              WasmMaze::WALL_STROKE_STYLE,
                              WasmMaze::WALL_LINE_WIDTH);
                },
                Some(CellEdge::Border) => {
                    draw_line(context,
                              canvas_coordinates.right,
                              canvas_coordinates.top,
                              canvas_coordinates.right,
                              canvas_coordinates.bottom,
                              WasmMaze::BORDER_STROKE_STYLE,
                              WasmMaze::BORDER_LINE_WIDTH);
                },
                _ => ()
            }
            match cell.edge(&Direction::South) {
                Some(CellEdge::Wall) => {
                    draw_line(context,
                              canvas_coordinates.left,
                              canvas_coordinates.bottom,
                              canvas_coordinates.right,
                              canvas_coordinates.bottom,
                              WasmMaze::WALL_STROKE_STYLE,
                              WasmMaze::WALL_LINE_WIDTH);
                },
                Some(CellEdge::Border) => {
                    draw_line(context,
                              canvas_coordinates.left,
                              canvas_coordinates.bottom,
                              canvas_coordinates.right,
                              canvas_coordinates.bottom,
                              WasmMaze::BORDER_STROKE_STYLE,
                              WasmMaze::BORDER_LINE_WIDTH);
                },
                _ => ()
            }
            if cell.edge(&Direction::West).unwrap() == CellEdge::Border {
                draw_line(context,
                          canvas_coordinates.left,
                          canvas_coordinates.top,
                          canvas_coordinates.left,
                          canvas_coordinates.bottom,
                          WasmMaze::BORDER_STROKE_STYLE,
                          WasmMaze::BORDER_LINE_WIDTH);
            }
        }
        // context.stroke();
        context.restore();
    }

    fn draw_player(&self, context: &web_sys::CanvasRenderingContext2d) {
        let player_maze_coordinates = self.canvas_coordinates(&self.player.coordinates());
        context.save();
        context
            .translate(player_maze_coordinates.left, player_maze_coordinates.bottom)
            .unwrap();
        self.player.draw(context);
        context.restore();
    }

    fn draw_goal(&self, context: &web_sys::CanvasRenderingContext2d) {
        crate::utils::set_panic_hook();
        let goal_maze_coordinates = self.canvas_coordinates(&self.goal);

        context.save();
        context.set_fill_style(&WasmMaze::GOAL_FILL_STYLE.into());
        context.set_stroke_style(&WasmMaze::GOAL_STROKE_STYLE.into());
        context.set_line_width(1.0);
        context
            .translate(
                goal_maze_coordinates.left + 3.0,
                goal_maze_coordinates.bottom,
            )
            .unwrap();
        context.scale(1.5, 1.5).expect("context should scale");
        let path2d = web_sys::Path2d::new_with_path_string("M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z").expect("path2d should exist");
        context.fill_with_path_2d(&path2d);
        context.stroke_with_path(&path2d);
        context.restore();
    }

    fn is_passage(&self, direction: &Direction) -> bool {
        if let Some(cell) = self.maze.cell(&self.player.coordinates()) {
            if let Some(edge) = cell.edge(direction) {
                return edge == CellEdge::Passage;
            }
        }
        false
    }

    pub fn is_won(&self) -> bool {
        self.player.coordinates() == self.goal
    }

    pub fn move_player_north(&mut self) -> bool {
        let mut changed = false;
        if self.player.direction() != Direction::North {
            self.player.set_direction(Direction::North);
            changed = true;
        }
        // y-axis is bottom to top in maze, top to bottom in canvas
        if self.is_passage(&Direction::South) {
            self.player.move_south();
            changed = true;
        }
        changed
    }

    pub fn move_player_east(&mut self) -> bool {
        let mut changed = false;
        if self.player.direction() != Direction::East {
            self.player.set_direction(Direction::East);
            changed = true;
        }
        if self.is_passage(&Direction::East) {
            self.player.move_east();
            changed = true;
        }
        changed
    }

    pub fn move_player_south(&mut self) -> bool {
        let mut changed = false;
        if self.player.direction() != Direction::South {
            self.player.set_direction(Direction::South);
            changed = true;
        }
        // y-axis is bottom to top in maze, top to bottom in canvas
        if self.is_passage(&Direction::North) {
            self.player.move_north();
            changed = true;
        }
        changed
    }

    pub fn move_player_west(&mut self) -> bool {
        let mut changed = false;
        if self.player.direction() != Direction::West {
            self.player.set_direction(Direction::West);
            changed = true;
        }
        if self.is_passage(&Direction::West) {
            self.player.move_west();
            changed = true;
        }
        changed
    }
}
