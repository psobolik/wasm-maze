The app uses `webpack` to pack the JavaScript files for distribution.
I couldn't get the HTML webpack plugin to work, so `index.html` is just copied to the `dist` folder.
That means that you have to edit the `src` attribute for the `bootstrap.js` script if you bundle it.

## Build the Rust code (from the `www` folder)
```shell
> pnpm build
```
## Run the front end without bundling it (from the `www` folder)
```shell
> pnpm start
```
The app is served at the following URLs:
- Loopback: 
  - [http://localhost:8080/](http://localhost:8080/) (IPv4)
  - [http://[::1]:8080/](http://[::1]:8080/) (IPv6)
- On Your Network: 
  - [http://192.168.1.12:8080/](http://192.168.1.12:8080/) (IPv4)
  - [http://[fd22:822e:747c:7b42:9f09:3595:1729:40a1]:8080/](http://[fd22:822e:747c:7b42:9f09:3595:1729:40a1]:8080/) (IPv6)

## Bundle the front end for distribution
```shell
> pnpm bundle
```
Configured to put files in `dist` folder.

To install on pop-os, first edit `index.html` and change the `script` element from
```html
<script src="../bootstrap.js"></script>
```
to
```html
<script src="./bootstrap.js"></script>
```
Then copy the files:
```
$ sudo mkdir /var/www/html/maze
$ sudo cp -r dist/* /var/www/html/maze
```
To install on tilde.team, copy the (edited) files:
```shell
$ rcp -r ./dist tilde.team:~/public_html/web-maze
```