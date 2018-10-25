const { parse } = require('querystring');
const multiparty = require('multiparty');

const formatData = obj => {
  const ret = {};
  Object.entries(obj).forEach(([key, value]) => {
    return ret[key] = value.join();
  });

  return ret;
};

const getDataFromStream = ctx => {
  return new Promise((resolve, reject) => {
    const { req, request: { type } } = ctx;
    let data = '';
    if (type === 'multipart/form-data') {
      const form = new multiparty.Form();
      form.parse(req, (err, fields) => {
        resolve({
          rawBody: '',
          body: formatData(fields)
        });
      });
    } else if (type === 'application/x-www-form-urlencoded') {
      req.on('data', chunk => {
        data += chunk;
      });

      req.on('error', error => {
        reject(error);
      });

      req.on('end', () => {
        resolve({
          rawBody: data,
          body: parse(data)
        });
      });
    }
  });
};
module.exports = async (ctx, next) => {
  const result = await getDataFromStream(ctx);
  if (result instanceof Error) {
    ctx.throw(500);
  } else {
    ctx.request.body = result.body;
    ctx.request.rawBody = result.rawBody;
  }
  next();
};
