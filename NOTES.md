Build for release (in the `www` folder)

`> yarn bundle`

Deploy the files in `www\dist` to Marconi `/usr/local/www/wasm-maze`.

_For some reason, I had to edit `index.html`, because it had the wrong path for `bootstrap.js`._

Create Apache config file `wasm-maze` in `/etc/apache2/sites-available`.

```config
Alias /wasm-maze "/usr/local/www/wasm-maze"
<Directory "/usr/local/www/wasm-maze">
    AddLanguage en .en
    AllowOverride None
    Allow from all
    Require ip 192.168.1
    Require ip 127.0.0.1
    DirectoryIndex index.html
</Directory>
```
