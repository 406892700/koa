
'use strict';

/**
 * Module dependencies.
 */

const contentDisposition = require('content-disposition'); // 创建Http Content-Disposition 请求头
const ensureErrorHandler = require('error-inject'); // 向stream中注入一个错误监听函数，又是一个10行以内的包[https://github.com/stream-utils/error-inject/blob/master/index.js]
const getType = require('cache-content-type'); // 使用LRU缓存方式获取contentType类型的第三方模块 [https://github.com/node-modules/cache-content-type/blob/master/index.js]
const onFinish = require('on-finished'); // 请求成功，关闭，或者失败
const isJSON = require('koa-is-json'); // 是否是一个json
const escape = require('escape-html'); // 转码html
const typeis = require('type-is').is; // 判断content-type类型
const statuses = require('statuses'); // 判断状态码是否是有效的
const destroy = require('destroy'); // 销毁一个流，处理了一些原生stream.destroy()方法的bug
const assert = require('assert'); // 断言模块
const extname = require('path').extname; // 判断扩展名
const vary = require('vary'); // 操作vary请求头
const only = require('only'); // 获取指定字段组成的对象
const util = require('util'); // 原生util模块

/**
 * Prototype.
 */

module.exports = {

  /**
   * Return the request socket.
   * 获取请求socket
   * @return {Connection}
   * @api public
   */

  get socket() {
    return this.res.socket;
  },

  /**
   * Return response header.
   * 获取响应头，做了一个兼容
   * @return {Object}
   * @api public
   */

  get header() {
    const { res } = this;
    return typeof res.getHeaders === 'function'
      ? res.getHeaders()
      : res._headers || {};  // Node < 7.7
  },

  /**
   * Return response header, alias as response.header
   * 返回headers,header的别名
   * @return {Object}
   * @api public
   */

  get headers() {
    return this.header;
  },

  /**
   * Get response status code.
   * 获取响应状态码
   * @return {Number}
   * @api public
   */

  get status() {
    return this.res.statusCode;
  },

  /**
   * Set response status code.
   * 设置响应状态码
   * @param {Number} code
   * @api public
   */

  set status(code) {
    if (this.headerSent) return;
    // 断言检查状态码的有效性
    assert('number' == typeof code, 'status code must be a number'); // 必须是数字
    assert(statuses[code], `invalid status code: ${code}`); // 检查是否是有效的状态码
    this._explicitStatus = true; // 明确的状态码
    this.res.statusCode = code; // 设置状态码
    if (this.req.httpVersionMajor < 2) this.res.statusMessage = statuses[code]; // 如果不是http2.0 http2.0相关阅读[https://juejin.im/entry/5981c5df518825359a2b9476]
    if (this.body && statuses.empty[code]) this.body = null; // 如果body不存在或者是204，205，304三个状态码，直接将body设为null
  },

  /**
   * Get response status message
   * 获取响应状态信息
   * @return {String}
   * @api public
   */

  get message() {
    return this.res.statusMessage || statuses[this.status];
  },

  /**
   * Set response status message
   * 设置响应的状态信息
   * @param {String} msg
   * @api public
   */

  set message(msg) {
    this.res.statusMessage = msg;
  },

  /**
   * Get response body.
   * 获取响应的body，这里需要区分ctx.req.body 和 ctx.body 前者是ctx.req的请求body,后者是ctx.res的响应body
   * @return {Mixed}
   * @api public
   */

  get body() {
    return this._body;
  },

  /**
   * Set response body.
   * 设置响应body
   * @param {String|Buffer|Object|Stream} val
   * @api public
   */

  set body(val) {
    const original = this._body;
    this._body = val;

    // no content
    // 如果是body没有内容的
    if (null == val) {
      if (!statuses.empty[this.status]) this.status = 204;
      // 删除一些无用的响应头
      this.remove('Content-Type');
      this.remove('Content-Length');
      this.remove('Transfer-Encoding');
      return;
    }

    // set the status
    // 没有设置明确状态码的话，那就设置为200
    if (!this._explicitStatus) this.status = 200;

    // set the content-type only if not yet set
    // 如果还没设置的话才设置`content-type`
    const setType = !this.header['content-type'];

    // string
    // ctx.body = 一个字符串
    if ('string' == typeof val) {
      if (setType) this.type = /^\s*</.test(val) ? 'html' : 'text';
      this.length = Buffer.byteLength(val);
      return;
    }

    // buffer
    // ctx.body = 一个buffer
    if (Buffer.isBuffer(val)) {
      if (setType) this.type = 'bin';
      this.length = val.length;
      return;
    }

    // stream
    // ctx.body = 一个stream
    if ('function' == typeof val.pipe) {
      onFinish(this.res, destroy.bind(null, val)); // 请求完成后，关闭这个流
      ensureErrorHandler(val, err => this.ctx.onerror(err)); // 想stream中注入一个错误监听函数，流中发生的错误，也将被onerror所捕获

      // overwriting
      // 移除掉Content-Length响应头
      if (null != original && original != val) this.remove('Content-Length');

      if (setType) this.type = 'bin';
      return;
    }

    // json
    // 否则就是一个json
    this.remove('Content-Length'); // 移除Content-Length
    this.type = 'json';
  },

  /**
   * Set Content-Length field to `n`.
   * 设置Content-Length
   * @param {Number} n
   * @api public
   */

  set length(n) {
    this.set('Content-Length', n);
  },

  /**
   * Return parsed response Content-Length when present.
   * 获取一个解析过的响应Content-Length
   * @return {Number}
   * @api public
   */

  get length() {
    const len = this.header['content-length'];
    const body = this.body;

    if (null == len) { // 没有设置过
      if (!body) return; // 如果没有body,这个方法掉了白调
      if ('string' == typeof body) return Buffer.byteLength(body); // 获取长度
      if (Buffer.isBuffer(body)) return body.length; // 获取buffer长度
      if (isJSON(body)) return Buffer.byteLength(JSON.stringify(body)); // 获取json字符串长度
      return;
    }

    return ~~len;
  },

  /**
   * Check if a header has been written to the socket.
   * 检查socket头是否写入
   * @return {Boolean}
   * @api public
   */

  get headerSent() {
    return this.res.headersSent;
  },

  /**
   * Vary on `field`.
   * 设置vary响应头
   * vary是什么?  Vary字段用于列出一个响应字段列表，告诉缓存服务器遇到同一个 URL 对应着不同版本文档的情况时，如何缓存和筛选合适的版本。
   * 相关阅读[https://cloud.tencent.com/info/e54383477b5b8d56f76c28ddc6c63aba.html]
   * @param {String} field
   * @api public
   */

  vary(field) {
    if (this.headerSent) return;

    vary(this.res, field);
  },

  /**
   * Perform a 302 redirect to `url`.
   *
   * The string "back" is special-cased
   * to provide Referrer support, when Referrer
   * is not present `alt` or "/" is used.
   * 表现为一个302的重定向
   * `back`是一个特殊情况
   * Examples:
   *
   *    this.redirect('back');
   *    this.redirect('back', '/index.html');
   *    this.redirect('/login');
   *    this.redirect('http://google.com');
   *
   * @param {String} url
   * @param {String} [alt]
   * @api public
   */

  redirect(url, alt) {
    // location
    // 设置url
    if ('back' == url) url = this.ctx.get('Referrer') || alt || '/'; // 获取请求头中的Referrer，这里需要注意，get是ctx.req.get
    this.set('Location', url); // 设置Location请求头

    // status
    // 设置状态码
    if (!statuses.redirect[this.status]) this.status = 302; // 如果不是有效的重定向状态码【300, 301, 302, 303, 305, 307, 308】，那就设置状态码为302

    // html
    // 根据请求头中的accpt字段判断，如果是html
    if (this.ctx.accepts('html')) {
      url = escape(url); // 转义url
      this.type = 'text/html; charset=utf-8'; // 设置content-type
      this.body = `Redirecting to <a href="${url}">${url}</a>.`; // 响应body,其实没用，浏览器会根据响应头中的Location完成自动跳转
      return;
    }

    // text
    this.type = 'text/plain; charset=utf-8';
    this.body = `Redirecting to ${url}.`;
  },

  /**
   * Set Content-Disposition header to "attachment" with optional `filename`.
   * 设置  Content-Disposition请求头
   * @param {String} filename
   * @api public
   */

  attachment(filename, options) {
    if (filename) this.type = extname(filename);
    // Content-Disposition 用于只是回复的内容该以何种形式展示，是内联还是附件
    // Content-Disposition 相关阅读[https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Headers/Content-Disposition]
    this.set('Content-Disposition', contentDisposition(filename, options));
  },

  /**
   * Set Content-Type response header with `type` through `mime.lookup()`
   * when it does not contain a charset.
   * 设置Content-Type
   * Examples:
   *
   *     this.type = '.html';
   *     this.type = 'html';
   *     this.type = 'json';
   *     this.type = 'application/json';
   *     this.type = 'png';
   *
   * @param {String} type
   * @api public
   */

  set type(type) {
    type = getType(type); // 获取type是否有效
    // 所有被支持的Content-Type类型
    // https://github.com/jshttp/mime-db/blob/master/db.json
    if (type) { // 如果有效
      this.set('Content-Type', type); // 设置
    } else {
      this.remove('Content-Type');
    }
  },

  /**
   * Set the Last-Modified date using a string or a Date.
   * 设置Last-Modified响应头,val可以是字符串，也可以是Date对象
   *     this.response.lastModified = new Date();
   *     this.response.lastModified = '2013-09-13';
   *
   * @param {String|Date} type
   * @api public
   */

  set lastModified(val) {
    if ('string' == typeof val) val = new Date(val);
    this.set('Last-Modified', val.toUTCString());
  },

  /**
   * Get the Last-Modified date in Date form, if it exists.
   * 获取Last-Modified响应头，返回格式为date对象
   * @return {Date}
   * @api public
   */

  get lastModified() {
    const date = this.get('last-modified');
    if (date) return new Date(date);
  },

  /**
   * Set the ETag of a response.
   * This will normalize the quotes if necessary.
   * 设置Etag响应头
   *     this.response.etag = 'md5hashsum';
   *     this.response.etag = '"md5hashsum"';
   *     this.response.etag = 'W/"123456789"';
   *
   * @param {String} etag
   * @api public
   */

  set etag(val) {
    if (!/^(W\/)?"/.test(val)) val = `"${val}"`;
    this.set('ETag', val);
  },

  /**
   * Get the ETag of a response.
   * 获取ETag响应头
   * @return {String}
   * @api public
   */

  get etag() {
    return this.get('ETag');
  },

  /**
   * Return the response mime type void of
   * parameters such as "charset".
   * 获取response的mime类型,将不会返回charset参数
   * @return {String}
   * @api public
   */

  get type() {
    const type = this.get('Content-Type');
    if (!type) return '';
    return type.split(';')[0];
  },

  /**
   * Check whether the response is one of the listed types.
   * Pretty much the same as `this.request.is()`.
   * 检查响应类型是不是在给定的列表中的
   * 与ctx.req.is类似
   * @param {String|Array} types...
   * @return {String|false}
   * @api public
   */

  is(types) {
    const type = this.type;
    if (!types) return type || false;
    if (!Array.isArray(types)) types = [].slice.call(arguments);
    return typeis(type, types);
  },

  /**
   * Return response header.
   * 获取响应头
   * Examples:
   *
   *     this.get('Content-Type');
   *     // => "text/plain"
   *
   *     this.get('content-type');
   *     // => "text/plain"
   *
   * @param {String} field
   * @return {String}
   * @api public
   */

  get(field) {
    return this.header[field.toLowerCase()] || '';
  },

  /**
   * Set header `field` to `val`, or pass
   * an object of header fields.
   * 设置响应头
   * Examples:
   *
   *    this.set('Foo', ['bar', 'baz']);
   *    this.set('Accept', 'application/json');
   *    this.set({ Accept: 'text/plain', 'X-API-Key': 'tobi' });
   *
   * @param {String|Object|Array} field
   * @param {String} val
   * @api public
   */

  set(field, val) {
    if (this.headerSent) return;

    if (2 == arguments.length) {
      if (Array.isArray(val)) val = val.map(v => typeof v === 'string' ? v : String(v));
      else if (typeof val !== 'string') val = String(val);
      this.res.setHeader(field, val);
    } else {
      for (const key in field) {
        this.set(key, field[key]);
      }
    }
  },

  /**
   * Append additional header `field` with value `val`.
   * 添加额外的请求头字段，不会覆盖原来的
   * Examples:
   *
   * ```
   * this.append('Link', ['<http://localhost/>', '<http://localhost:3000/>']);
   * this.append('Set-Cookie', 'foo=bar; Path=/; HttpOnly');
   * this.append('Warning', '199 Miscellaneous warning');
   * ```
   *
   * @param {String} field
   * @param {String|Array} val
   * @api public
   */

  append(field, val) {
    const prev = this.get(field); // 判断需要追加的请求头是否已经存在，如果存在，则返回

    if (prev) { // 又存在的就向上追加
      val = Array.isArray(prev)
        ? prev.concat(val)
        : [prev].concat(val);
    }

    return this.set(field, val); // 设置
  },

  /**
   * Remove header `field`.
   * 移除某个请求头
   * @param {String} name
   * @api public
   */

  remove(field) {
    if (this.headerSent) return;

    this.res.removeHeader(field);
  },

  /**
   * Checks if the request is writable.
   * Tests for the existence of the socket
   * as node sometimes does not set it.
   * 检查request是不是可写的，
   * socket存在性检查，因为node有时候不设置它
   * @return {Boolean}
   * @api private
   */

  get writable() {
    // can't write any more after response finished
    if (this.res.finished) return false; // 响应结束不能再写

    const socket = this.res.socket;
    // There are already pending outgoing res, but still writable
    // https://github.com/nodejs/node/blob/v4.4.7/lib/_http_server.js#L486
    if (!socket) return true;
    return socket.writable;
  },

  /**
   * Inspect implementation.
   * 实现inspect，console.log(this)的时候，将输出这个函数返回值
   * @return {Object}
   * @api public
   */

  inspect() {
    if (!this.res) return;
    const o = this.toJSON();
    o.body = this.body;
    return o;
  },

  /**
   * Return JSON representation.
   * 只显示特定的字段
   * @return {Object}
   * @api public
   */

  toJSON() {
    return only(this, [
      'status',
      'message',
      'header'
    ]);
  },

  /**
   * Flush any set headers, and begin the body
   * 刷新响应头
   */
  flushHeaders() {
    this.res.flushHeaders();
  }
};

/**
 * Custom inspection implementation for newer Node.js versions.
 * 为新的nodejs版本定制的inspection
 * @return {Object}
 * @api public
 */
if (util.inspect.custom) {
  module.exports[util.inspect.custom] = module.exports.inspect;
}
