# Wasm Maze

Another maze app; This one runs in a browser. 

This app uses a version of the maze generator, rewritten in Rust, to create mazes. 
The maze generator is in a separate Rust library, named `maze_lib`.

This project has Rust code to fetch maze data and to draw the maze, the player, and goal images on an HTML 2D canvas. 
It also has code that will update the player's position and detect when the player has reached the goal, which is called from JavaScript. 
The part of the app that is written in Rust uses `wasm-pack` to compile the source into WebAssembly, 
and to generate the JavaScript boilerplate needed to interact with it.

The app also contains some static HTML and JavaScript to provide the user interface. 
The JavaScript code interacts with the maze code. 

