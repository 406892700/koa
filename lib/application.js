
'use strict';

/**
 * Module dependencies.
 */

const isGeneratorFunction = require('is-generator-function'); // 是否是生长器函数
const debug = require('debug')('koa:application'); // 调试模块
const onFinished = require('on-finished'); // 请求关闭，报错或者结束时执行回调
const response = require('./response'); // res对象
const compose = require('koa-compose'); // 组合中间件的函数
const isJSON = require('koa-is-json'); // 判断要返回的是不是json,6行代码的包。。。
const context = require('./context'); // 上下文ctx对象
const request = require('./request'); // req对象
const statuses = require('statuses'); // 处理状态码的模块
const Emitter = require('events'); // 继承了node原生的event模块，兼容一些老版本node环境所不支持的方法
const util = require('util'); // 原生util模块
const Stream = require('stream'); // 原生stream模块
const http = require('http'); // 原生http模块
const only = require('only'); // 选择对象中的某些特定项目，并返回新对象
const convert = require('koa-convert'); // 将老版本koa中的genertor方式的中间件转换为新的promise形式的中间件
const deprecate = require('depd')('koa'); // 提示一些不再推荐使用的特性

/**
 * Expose `Application` class.
 * Inherits from `Emitter.prototype`.
 * Application继承了nodejs的事件对象EventEmitter
 */

module.exports = class Application extends Emitter {
  /**
   * Initialize a new `Application`.
   *
   * @api public
   */

  constructor() {
    super();

    this.proxy = false; // 代理头部的字段是否需要解析
    this.middleware = []; // 中间件数组
    this.subdomainOffset = 2; // 子域名计算的偏移(e.g. 如果subdomainOffset=2,则计算api.web.jituancaiyun.com的subdomains为['api', 'web'])
    this.env = process.env.NODE_ENV || 'development'; // 启动环境
    this.context = Object.create(context); // 将上下文对象挂载至app
    this.request = Object.create(request); // 将request对象挂载至app
    this.response = Object.create(response); // 将response对象挂载至app
    if (util.inspect.custom) {
      // 设置终端样式颜色 参考阅读[http://nodejs.cn/api/util.html#util_custom_inspection_functions_on_objects]
      this[util.inspect.custom] = this.inspect;
    }
  }

  /**
   * Shorthand for:
   *
   *    http.createServer(app.callback()).listen(...)
   *
   * @param {Mixed} ...
   * @return {Server}
   * @api public
   * 原生方法crateServer().listen()的快捷访问方式
   */

  listen(...args) {
    debug('listen');
    const server = http.createServer(this.callback());
    return server.listen(...args);
  }

  /**
   * Return JSON representation.
   * We only bother showing settings.
   *
   * @return {Object}
   * @api public
   */

  toJSON() {
    // 只显示特定的一些属性
    return only(this, [
      'subdomainOffset',
      'proxy',
      'env'
    ]);
  }

  /**
   * Inspect implementation.
   *
   * @return {Object}
   * @api public
   * 检查app对象
   */
  inspect() {
    return this.toJSON();
  }

  /**
   * Use the given middleware `fn`.
   *
   * Old-style middleware will be converted.
   * 用老方式generator写的中间件也会被转型
   * @param {Function} fn
   * @return {Application} self
   * @api public
   */

  use(fn) {
    if (typeof fn !== 'function') throw new TypeError('middleware must be a function!'); // 中间件首先必须是个函数
    if (isGeneratorFunction(fn)) { // 如果是老的形式的中间，将会提示`不再推荐警告`
      deprecate('Support for generators will be removed in v3. ' +
                'See the documentation for examples of how to convert old middleware ' +
                'https://github.com/koajs/koa/blob/master/docs/migration.md');
      // 转型 参考阅读[https://github.com/koajs/convert/blob/master/index.js]
      // 使用了`koa-compose` 和 tj大神的的`co`模块
      fn = convert(fn);
    }
    debug('use %s', fn._name || fn.name || '-'); // 调试模式下输出中间件使用信息
    this.middleware.push(fn); // 加入到中间件数组
    return this;
  }

  /**
   * Return a request handler callback
   * for node's native http server.
   *
   * @return {Function}
   * @api public
   * 为原生的httpServer提供一个处理请求的回调函数
   */

  callback() {
    // 组合中间件 参考阅读[https://github.com/koajs/compose/blob/master/index.js]
    const fn = compose(this.middleware);
    // `listenCount`和`on`均是`EventEmitter`中继承而来的方法
    // 如果没有监听`error`事件的话，那就监听一个
    if (!this.listenerCount('error')) this.on('error', this.onerror);

    const handleRequest = (req, res) => {
      const ctx = this.createContext(req, res); // 创建上下文对象ctx,保证每个请求的上下文都是独立的
      return this.handleRequest(ctx, fn); // 为每一个请求都返回一个独立的回调
    };

    return handleRequest;
  }

  /**
   * Handle request in callback.
   *
   * @api private
   * 处理请求的回调函数
   */

  handleRequest(ctx, fnMiddleware) {
    const res = ctx.res;
    res.statusCode = 404; // 先默认返回404,如果使用了路由中间件，则路由中间件会处理接下去的流程和返回
    const onerror = err => ctx.onerror(err);
    const handleResponse = () => respond(ctx);
    onFinished(res, onerror); // 当一个请求完成，报错，或者关闭时触发回调
    return fnMiddleware(ctx)// 每一个请求都需要经过一遍所有的中间件
      .then(handleResponse) // 响应请求
      .catch(onerror); // 处理中间件中的错误
      // (参看koa-compose源码可知，中间件返回的是一个个的promise，中间的错误可以通过catch处理，这样一来，所有在中间件中的未处理的错误都会在这里被捕获)
  }

  /**
   * Initialize a new context.
   *
   * @api private
   * 创建新上下文方法
   */

  createContext(req, res) {
    const context = Object.create(this.context);
    const request = context.request = Object.create(this.request);
    const response = context.response = Object.create(this.response);
    // 处理一些request和response，使得可以直接通过ctx访问
    context.app = request.app = response.app = this;
    context.req = request.req = response.req = req; // nodejs原生的http.ClientRequest对象
    context.res = request.res = response.res = res; // nodejs原生的http.ServerResponse对象
    request.ctx = response.ctx = context;
    request.response = response;
    response.request = request;
    context.originalUrl = request.originalUrl = req.url;
    context.state = {};
    return context;
  }

  /**
   * Default error handler.
   *
   * @param {Error} err
   * @api private
   * 默认的错误处理,未处理的错误都会被该回调函数处理
   */

  onerror(err) {
    if (!(err instanceof Error)) throw new TypeError(util.format('non-error thrown: %j', err));

    if (404 == err.status || err.expose) return;
    if (this.silent) return;

    const msg = err.stack || err.toString();
    console.error();
    console.error(msg.replace(/^/gm, '  '));
    console.error();
  }
};

/**
 * Response helper.
 * 响应对象处理函数
 */

function respond(ctx) {
  // allow bypassing koa
  if (false === ctx.respond) return; // 如果你需要自己去重写原生的res对象的话，设置 `ctx.respond = false`

  const res = ctx.res;
  if (!ctx.writable) return; // 检测ctx是否可写

  let body = ctx.body;
  const code = ctx.status;

  // ignore body
  // 在以下三个状态码情况下忽略掉body
  // 204 => no content 没有内容
  // 205 => reset content 期望客户端重置请求参数
  // 304 => not modified 没改变
  if (statuses.empty[code]) {
    // strip headers
    ctx.body = null;
    return res.end();
  }

  // 处理METHOD = HEAD
  if ('HEAD' == ctx.method) {
    if (!res.headersSent && isJSON(body)) {
      ctx.length = Buffer.byteLength(JSON.stringify(body));
    }
    return res.end();
  }

  // status body
  // 如果body没有设置
  if (null == body) {
    body = ctx.message || String(code);
    if (!res.headersSent) {
      ctx.type = 'text';
      ctx.length = Buffer.byteLength(body);
    }
    return res.end(body);
  }

  // responses
  if (Buffer.isBuffer(body)) return res.end(body); // 是buffer对象，调用end方法
  if ('string' == typeof body) return res.end(body); // 是字符串
  if (body instanceof Stream) return body.pipe(res); // 如果是一个流的话，调用pipe

  // body: json
  body = JSON.stringify(body); // 如果是json对象，那就转化为字符串心事
  if (!res.headersSent) { // 如果响应头尚未已经发送，需要加上`Content-Length`响应头
    ctx.length = Buffer.byteLength(body);
  }
  res.end(body); // 终于把响应发出去了....
}
