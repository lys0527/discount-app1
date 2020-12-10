import "@babel/polyfill";
import dotenv from "dotenv";
import "isomorphic-fetch";
import createShopifyAuth, { verifyRequest } from "@shopify/koa-shopify-auth";
import graphQLProxy, { ApiVersion } from "@shopify/koa-shopify-graphql-proxy";
import Koa from "koa";
import next from "next";
import Router from "koa-router";
import session from "koa-session";
const crypto = require('crypto');
const HMAC_SECRET = API_SECRET;

const API_KEY = `${process.env.SHOPIFY_API_KEY}`;
const API_SECRET = `${process.env.SHOPIFY_API_SECRET}`;
const API_PERMISSION = `${process.env.SHOPIFY_API_PERMISSION}`;
const API_VERSION = `${process.env.SHOPIFY_API_VERSION}`
import * as handlers from "./handlers/index";
dotenv.config();
//const { default: graphQLProxy } = require('@shopify/koa-shopify-graphql-proxy');
const port = parseInt(process.env.PORT, 10) || 8081;
const dev = process.env.NODE_ENV !== "production";
const app = next({
  dev,
});
//const Router = require('koa-router');
const handle = app.getRequestHandler();
const { SHOPIFY_API_SECRET, SHOPIFY_API_KEY, SCOPES } = process.env;
const router = new Router();

app.prepare().then(() => {
  const server = new Koa();
  
  server.use(
    session(
      {
        sameSite: "none",
        secure: true,
      },
      server
    )
  );
  server.keys = [SHOPIFY_API_SECRET];
  server.use(
    createShopifyAuth({
      apiKey: SHOPIFY_API_KEY,
      secret: SHOPIFY_API_SECRET,
      scopes: ['read_products', 'write_products'],

      async afterAuth(ctx) {
        //Auth token and shop available in session
        //Redirect to shop upon auth
        const { shop, accessToken } = ctx.session;
        ctx.cookies.set("shopOrigin", shop, {
          httpOnly: false,
          secure: true,
          sameSite: "none",
        });
        ctx.redirect("/");
      },
    })
  );
  server.use(
    graphQLProxy({
      version: ApiVersion.October19,
    })
  );
  router.get("(.*)", verifyRequest(), async (ctx) => {
    await handle(ctx.req, ctx.res);
    ctx.respond = false;
    ctx.res.statusCode = 200;
  });
  server.use(router.allowedMethods());
  server.use(router.routes());
  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});

// const GRAPHQL_PATH_ADMIN = `admin/api/${API_VERSION}/graphql.json`;
// const RESTAPI_PATH_ADMIN = `admin/api/${API_VERSION}`;
// const GRAPHQL_PATH_STOREFRONT = `api/${API_VERSION}/graphql.json`;

const UNDEFINED = 'undefined';
// app.use(serve(__dirname + '/public'));
//Mongo URL and DB name for date store
const MONGO_URL = `${process.env.SHOPIFY_MONGO_URL}`;
const MONGO_DB_NAME = `${process.env.SHOPIFY_MONGO_DB_NAME}`;
const MONGO_COLLECTION = 'shops';

//
const getDB = function(key) {
  return new Promise(function(resolve, reject) { mongo.MongoClient.connect(MONGO_URL).then(function(db){
    //console.log(`getDB Connected ${MONGO_URL}`);
    var dbo = db.db(MONGO_DB_NAME);    
    //console.log(`getDB Used ${MONGO_DB_NAME}`);
    console.log(`getDB findOne, _id:${key}`);
    dbo.collection(MONGO_COLLECTION).findOne({"_id": `${key}`}).then(function(res){
      db.close();
      if (res == null) return resolve(null);
      return resolve(res.data);
    }).catch(function(e){
      console.log(`getDB Error ${e}`);
    });
  }).catch(function(e){
    console.log(`getDB Error ${e}`);
  });});
};

//
const callGraphql = function(ctx, shop, ql, token = null, path = GRAPHQL_PATH_ADMIN, vars = null) {
  return new Promise(function (resolve, reject) {
    let api_req = {};
    // Set Gqphql string into query field of the JSON  as string
    api_req.query = ql.replace(/\n/g, '');
    if (vars != null) {
      api_req.variables = vars;
    }
    var access_token = token;
    var storefront = false;
    if (path == GRAPHQL_PATH_STOREFRONT) storefront = true;
    if (access_token == null) {
      getDB(shop).then(function(shop_data){
        if (shop_data == null) return resolve(null);
        access_token = shop_data.access_token;
        if (storefront) access_token = shop_data.storefront_access_token;
        accessEndpoint(ctx, `https://${shop}/${path}`, api_req, access_token, CONTENT_TYPE_JSON, 'POST', storefront).then(function(api_res){
          return resolve(api_res);
        }).catch(function(e){
          console.log(`callGraphql ${e}`);
          return reject(e);
        }); 
      }).catch(function(e){
        console.log(`callGraphql ${e}`);
        return reject(e);
      });     
    } else {
      accessEndpoint(ctx, `https://${shop}/${path}`, api_req, access_token, CONTENT_TYPE_JSON, 'POST', storefront).then(function(api_res){
        return resolve(api_res);
      }).catch(function(e){
        console.log(`callGraphql ${e}`);
        return reject(e);
      }); 
    }   
  });
};

// --- Auth by frontend App Bridge ---
// router.get('/auth',  async (ctx, next) => { 
//   console.log("+++++++++ /auth ++++++++++");
//   let shop = ctx.request.query.shop;
//   let locale = ctx.request.query.locale;
//   await ctx.render('auth', {
//     api_key: API_KEY,
//     api_permission: API_PERMISSION,
//     callback: `https://${ctx.request.hostname}/callback`,
//     shop: shop,
//     locale: locale
//   });
// });

//top
router.get('/',  async (ctx, next) => {  
  console.log("+++++++++ / ++++++++++");
  if (!checkSignature(ctx.request.query)) {
    ctx.status = 400;
    return;
  }

  let shop = ctx.request.query.shop;
  let locale = ctx.request.query.locale;

  var shop_data = await(getDB(shop)); 
    api_res = await(callGraphql(ctx, shop, `{
      shop {
        currencyCode
        currencyFormats {
          moneyWithCurrencyFormat
        }
        taxesIncluded  
        privateMetafields(first:5, namespace:"${METAFIELD_NAMESPACE}") {
          edges {
            cursor
            node {
              ... on PrivateMetafield {
                namespace
                id
                key
                value
                valueType
              }
            }
          }      
        }
      }    
    }`));
    console.log(`${JSON.stringify(api_res)}`);
    let tax_included = api_res.data.shop.taxesIncluded;
    var is_dynamic = true;
    var with_text = false;
    var replace_all = true;
    let eSize = api_res.data.shop.privateMetafields.edges.length;    
    for (let i=0; i<eSize; i++) {
      if (api_res.data.shop.privateMetafields.edges[i].node.key == METAFIELD_KEY_IS_DYNAMIC) {
        is_dynamic = api_res.data.shop.privateMetafields.edges[i].node.value;
      }
      if (api_res.data.shop.privateMetafields.edges[i].node.key == METAFIELD_KEY_WITH_TEXT) {
        with_text = api_res.data.shop.privateMetafields.edges[i].node.value;
      }
      if (api_res.data.shop.privateMetafields.edges[i].node.key == METAFIELD_KEY_REPLACE_ALL) {
        replace_all = api_res.data.shop.privateMetafields.edges[i].node.value;
      }
    }    

    await ctx.render('top', {
      tax: tax,
      country: country,
      tax_included: tax_included,     
      is_dynamic: is_dynamic,
      with_text: with_text,
      replace_all: replace_all,       
      shop: shop,
      locale: locale
    });
  }
);

const callRESTAPI = function(ctx, shop, sub_path, json, method = 'POST', token = null, path = RESTAPI_PATH_ADMIN) {
  return new Promise(function (resolve, reject) {
    var access_token = token;
    if (access_token == null) {
      getDB(shop).then(function(shop_data){
        if (shop_data == null) return resolve(null);
        access_token = shop_data.access_token;         
        accessEndpoint(ctx, `https://${shop}/${path}/${sub_path}.json`, json, access_token, CONTENT_TYPE_JSON, method).then(function(api_res){
          return resolve(api_res);
        }).catch(function(e){
          console.log(`callGraphql ${e}`);
          return reject(e);
        }); 
      }).catch(function(e){
        console.log(`callGraphql ${e}`);
        return reject(e);
      });     
    } else {
      accessEndpoint(ctx, `https://${shop}/${path}/${sub_path}.json`, json, access_token, CONTENT_TYPE_JSON, method).then(function(api_res){
        return resolve(api_res);
      }).catch(function(e){
        console.log(`callGraphql ${e}`);
        return reject(e);
      }); 
    }   
  });
};
// var api_res = await(callGraphql(ctx, shop, `{
//   app {
//     handle
//   }
// }`));
// let redirect_url = `https://${shop}/admin/apps/${api_res.data.app.handle}`;

// let src_url = `https://${ctx.request.hostname}/scripts/discount.js`;

router.get('proxy',  async (ctx, next) => {
  // api_res = await(callRESTAPI(ctx, shop, 'script_tags', {
  //   "script_tag": {
  //     "event": "onload",
  //     "src": 'https://akitodemo.myshopify.com-app-website/shopify.js'
  //   }
  // }));
  const response = await fetch(`https://${shop}/admin/api/2020-07/script_tags.json`, {
  method: 'POST',
  cache: 'no-cache',
  headers: {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Cache-Control': 'no-cache'
  },
  body: JSON.stringify({
    script_tag: {
      event: "onload",
      src: "https://7a010899801d.ngrok.io/scripts/discount.js",
      displayScope: "online_store"
    }
  })
});
console.log('response', response)
  cosole.log("------------/proxy-----------")
  if (!checkAppProxySignature(ctx.request.query)) {
    ctx.status = 400;
    return;
  }
  api_res = await(callGraphql(ctx, shop, `{
    products(id: "gid://shopify/products/${data_id}") {
      query getProducts(first: 30) {
        edges {
          node {
            variants(first: 30) {
              edges {
                node {
                  price
                  compareAtPrice
                }
              }
            }
          }
        }
      } 
    }
  }`));
  exports.discount1 = function discount1 (){
    res.compare_at_price = api_res.data.products.edges.node.variants.edges.node.compare_at_price;
    var firstPrice = compare_at_price;
    
    return firstPrice;
  }

  exports.discount2 = function discount2 (){
    res.price = api_res.data.products.edges.node.variants.edges.node.price;
    var beforePrice = price;

    return beforePrice;

  }

  if (beforePrice === firstPrice) {
  nochenge 
  } else {
    var difference = beforePrice - firstPrice
    return difference;
  }
});

const checkSignature = function(json) {
  let temp = JSON.parse(JSON.stringify(json));
  console.log(`checkSignature ${JSON.stringify(temp)}`);
  if (typeof temp.hmac === UNDEFINED) return false;
  let sig = temp.hmac;
  delete temp.hmac; 
  let msg = Object.entries(temp).sort().map(e => e.join('=')).join('&');
  //console.log(`checkSignature ${msg}`);
  const hmac = crypto.createHmac('sha256', HMAC_SECRET);
  hmac.update(msg);
  let signarure =  hmac.digest('hex');
  //console.log(`checkSignature ${signarure}`);
  return signarure === sig ? true : false;
};
