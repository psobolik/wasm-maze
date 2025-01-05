const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require('path');

module.exports = {
    entry: "./bootstrap.js",
    output: {
        clean: true,
        path: path.resolve(__dirname, "dist"),
        filename: "bootstrap.js",
    },
    mode: "production",
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                { from: path.resolve(__dirname, "app") },
            ],
        })
    ],
    experiments: {
        asyncWebAssembly: true,
    },
};
