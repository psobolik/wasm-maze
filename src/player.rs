use maze_lib::maze::coordinates::Coordinates;
use maze_lib::maze::direction::Direction;

#[derive(Debug)]
pub struct Player {
    size: f64,
    coordinates: Coordinates,
    direction: Direction,
    stroke_color: String,
    fill_color: String,
}

impl Player {
    /// Returns the player's direction
    pub fn direction(&self) -> Direction {
        self.direction
    }

    // Sets the player's direction
    pub fn set_direction(&mut self, direction: Direction) {
        self.direction = direction
    }

    /// Returns the player's coordinates
    pub fn coordinates(&self) -> Coordinates {
        self.coordinates
    }

    /// Returns a player with the given attributes at (0,0), facing north
    pub fn new(
        height: f64,
        stroke_color: &str,
        fill_color: &str,
    ) -> Player {
        Player::new_with_column_and_row(height, 0, 0, stroke_color, fill_color)
    }

    /// Returns a player with the given attributes and location, facing north
    pub fn new_with_column_and_row(
        height: f64,
        column: u32,
        row: u32,
        stroke_color: &str,
        fill_color: &str,
    ) -> Player {
        Player::new_with_coordinates(
            height,
            Coordinates::new(column as i32, row as i32),
            stroke_color,
            fill_color,
        )
    }

    /// Returns a player with the given attributes and location, facing north
    pub fn new_with_coordinates(
        height: f64,
        coordinates: Coordinates,
        stroke_color: &str,
        fill_color: &str,
    ) -> Player {
        Player {
            // height,
            size: height / 2.0,
            coordinates,
            stroke_color: stroke_color.to_string(),
            fill_color: fill_color.to_string(),
            direction: Direction::North,
        }
    }

    pub fn move_north(&mut self) {
        self.coordinates += Direction::North.coordinates();
    }

    pub fn move_east(&mut self) {
        self.coordinates += Direction::East.coordinates();
    }

    pub fn move_south(&mut self) {
        self.coordinates += Direction::South.coordinates();
    }

    pub fn move_west(&mut self) {
        self.coordinates += Direction::West.coordinates();
    }

    /// Returns the angle in radians that the player should be rotated clockwise to face in the correct direction
    fn rotation(&self) -> f64 {
        match self.direction {
            Direction::North => 0.0,
            Direction::East => std::f64::consts::PI * 0.5,
            Direction::South => std::f64::consts::PI,
            Direction::West => std::f64::consts::PI * 1.5,
        }
    }

    /// Draws the player in the context
    pub fn draw(&self, context: &web_sys::CanvasRenderingContext2d) {
        context.save();
        context.translate(self.size, self.size).unwrap();
        context.scale(0.75, 0.75).unwrap();
        context.rotate(self.rotation()).unwrap();
        context.set_fill_style_str(self.fill_color.as_str());
        context.set_stroke_style_str(self.stroke_color.as_str());
        context.begin_path();
        context.move_to(-self.size, self.size);
        context.line_to(0.0, -self.size);
        context.line_to(self.size, self.size);
        context.close_path();
        context.fill();
        context.stroke();
        context.restore();
    }
}
