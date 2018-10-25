const fs = require('fs');
const ejs = require('ejs');
const path = require('path');

module.exports = basePath => {
  return async (ctx, next) => {
    ctx.render = (dir, data) => {
      try {
        const tpl = fs.readFileSync(path.resolve(basePath, dir)).toString();
        ctx.body = ejs.render(tpl, data || {});
      } catch (e) {
        ctx.throw(500);
      }
    };
    next();
  };
};
