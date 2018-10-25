const VERB = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'CONNECT', 'OPTIONS', 'TRACE', 'PATCH']; // 请求动词

function KoaRouter() {
  this.matches = {};
  generateVerbMethod(this);
}

KoaRouter.prototype.routes = function() {
  return (ctx, next) => {
    try {
      // this.matches[method.toLowerCase()][url](ctx);
      this.match(ctx)(ctx);
    } catch (e) {
      ctx.throw(404);
    } finally {
      next();
    }
  };
};

KoaRouter.prototype.match = function(ctx) {
  const { path, method } = ctx;
  const candidate = this.matches[method.toLowerCase()];
  const patternArr = Object.keys(candidate);
  let len = patternArr.length;
  for (let i = 0; i < len; i++) {
    const it = patternArr[i];
    const pathReg = new RegExp('^' + it.replace(/(:[^/$]+)/g, () => '([^/$]+)') + '$');
    const matchArr = pathReg.exec(path);

    if (matchArr) {
      const paramArr = it.match(/(:[^/$]+)/g);
      const pLen = (paramArr || []).length;
      const param = {};
      const values = matchArr.slice(1, 1 + pLen);
      values.forEach((value, index) => {
        param[paramArr[index].slice(1)] = value;
      });
      ctx.request.param = param;
      return candidate[it]; // 返回处理函数
    }
  }
};

function generateVerbMethod(self) {
  VERB.forEach(verb => {
    const lowercaseVerb = verb.toLowerCase();
    KoaRouter.prototype[lowercaseVerb] = function(path, callback) {
      const matchedVerb = self.matches[lowercaseVerb];
      !matchedVerb && (self.matches[lowercaseVerb] = {});
      self.matches[lowercaseVerb][path] = callback;
    };
  });
}

module.exports = KoaRouter;
