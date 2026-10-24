// SPDX-License-Identifier: GPL-3.0-or-later
package com.cinetor.engines.nuvio

internal object UrlBindings {
    val code = """
        var URLSearchParams = function(init) {
            this._pairs = [];
            if (init instanceof URLSearchParams) this._pairs = init._pairs.map(function(p) { return p.slice(); });
            else if (typeof init === 'string') {
                var value = init.replace(/^\?/, '');
                if (value) value.split('&').forEach(function(pair) {
                    if (!pair) return;
                    var pos = pair.indexOf('=');
                    var k = pos < 0 ? pair : pair.slice(0, pos);
                    var v = pos < 0 ? '' : pair.slice(pos + 1);
                    this._pairs.push([decodeURIComponent(k.replace(/\+/g, ' ')), decodeURIComponent(v.replace(/\+/g, ' '))]);
                }, this);
            } else if (Array.isArray(init)) init.forEach(function(p) { this.append(p[0], p[1]); }, this);
            else if (init) Object.keys(init).forEach(function(k) { this.append(k, init[k]); }, this);
        };
        URLSearchParams.prototype._changed = function() { if (this._onChange) this._onChange(this.toString()); };
        URLSearchParams.prototype.get = function(k) { var p = this._pairs.find(function(p) { return p[0] === String(k); }); return p ? p[1] : null; };
        URLSearchParams.prototype.getAll = function(k) { return this._pairs.filter(function(p) { return p[0] === String(k); }).map(function(p) { return p[1]; }); };
        URLSearchParams.prototype.has = function(k) { return this.get(k) !== null; };
        URLSearchParams.prototype.append = function(k, v) { this._pairs.push([String(k), String(v)]); this._changed(); };
        URLSearchParams.prototype.delete = function(k) { this._pairs = this._pairs.filter(function(p) { return p[0] !== String(k); }); this._changed(); };
        URLSearchParams.prototype.set = function(k, v) {
            k = String(k); v = String(v); var found = false;
            this._pairs = this._pairs.filter(function(p) { if (p[0] !== k) return true; if (found) return false; p[1] = v; found = true; return true; });
            if (!found) this._pairs.push([k, v]); this._changed();
        };
        URLSearchParams.prototype.sort = function() { this._pairs.sort(function(a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }); this._changed(); };
        URLSearchParams.prototype.toString = function() {
            function enc(s) { return encodeURIComponent(s).replace(/[!'()~]/g, function(c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); }).replace(/%20/g, '+'); }
            return this._pairs.map(function(p) { return enc(p[0]) + '=' + enc(p[1]); }).join('&');
        };
        URLSearchParams.prototype.entries = function() { return this._pairs.map(function(p) { return p.slice(); })[Symbol.iterator](); };
        URLSearchParams.prototype.keys = function() { return this._pairs.map(function(p) { return p[0]; })[Symbol.iterator](); };
        URLSearchParams.prototype.values = function() { return this._pairs.map(function(p) { return p[1]; })[Symbol.iterator](); };
        URLSearchParams.prototype.forEach = function(fn, self) { this._pairs.forEach(function(p) { fn.call(self, p[1], p[0], this); }, this); };
        URLSearchParams.prototype[Symbol.iterator] = URLSearchParams.prototype.entries;
        var URL = function(value, base) { this._set(String(value), base == null ? '' : String(base)); };
        URL.prototype._set = function(value, base) {
            this._data = JSON.parse(__parse_url(value, base));
            var self = this;
            if (!this.searchParams) this.searchParams = new URLSearchParams(this._data.search);
            else this.searchParams._pairs = new URLSearchParams(this._data.search)._pairs;
            this.searchParams._onChange = function(q) { self.search = q ? '?' + q : ''; };
        };
        ['href','protocol','host','hostname','port','pathname','search','hash','origin','username','password'].forEach(function(k) {
            Object.defineProperty(URL.prototype, k, {
                get: function() { return this._data[k]; },
                set: function(v) { if (k === 'origin') throw new TypeError('Origin is read-only'); this._set(__url_set(this._data.href, k, String(v)), ''); }
            });
        });
        URL.prototype.toString = URL.prototype.toJSON = function() { return this.href; };
    """.trimIndent()
}
