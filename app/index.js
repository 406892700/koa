const path = require('path');
const Koa = require('../lib/application');

const app = new Koa();
const Router = require('./middleware/koa-router');
const BodyParser = require('./middleware/body-parser');
const ejsRender = require('./middleware/koa-render');

const router = new Router();

router.get('/name/:id/age', async ctx => {
  console.log(ctx.request.param);
  ctx.body = {
    test: 'simple'
  };
});

router.post('/testPost/:id', async ctx => {
  console.log(ctx.request.body);
  // ctx.body = {
  //   param: ctx.request.param
  // };

  await ctx.render('index.html22', ctx.request.body);
});

// 未捕获的错误在这里处理
app.on('error', err => {
  console.log(err);
});

app.use(BodyParser);
app.use(ejsRender('app/views'));
app.use(router.routes());

app.use(async (ctx, next) => {
  // ctx.status = 404;
  const { status, message } = ctx;
  ctx.body = {
    code: status,
    message: message
  };
  return next();
});

app.listen(6006);

// 监听未捕获的异常
process.on('unhandledRejection', err => {
  console.log(err);
});
