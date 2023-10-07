# Wasm Maze

Another maze app; this one runs in a browser. 

This app uses a version of the maze generator, rewritten in Rust, to create mazes. The maze 
generator is in a separate project, named `maze_lib`.

This project has Rust code to fetch maze data and to draw it, the player and goal images on an
HTML 2D canvas. It also has code that will update the player's position and detect when the
player has reached the goal. This part of the app is written in Rust, and uses `wasm-pack` 
to build the source into WebAssembly, along with the JavaScript boilerplate needed to 
interact with it.

The app also contains some static HTML and JavaScript to provide the user interface. 
The JavaScript code interacts with the maze code. 

The app uses `webpack` to build everything into a distributable package. 


