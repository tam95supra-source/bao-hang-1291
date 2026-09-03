'use strict';
const playwright=require('playwright-core');
const originalLaunch=playwright.chromium.launch.bind(playwright.chromium);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function navOptions(options={}){
  const requested=Number(options?.timeout||0);
  return {...options,waitUntil:'commit',timeout:Math.max(requested,45000)};
}
async function withNavigationRetry(run,label){
  let last;
  for(let attempt=1;attempt<=3;attempt++){
    try{return await run();}
    catch(error){
      last=error;
      const message=String(error?.message||error);
      const retryable=/Timeout|net::ERR|Navigation|Target page, context or browser has been closed/i.test(message);
      if(!retryable||attempt===3)throw error;
      console.warn('WEB_SHELL_NAV_RETRY label='+label+' attempt='+attempt+' error='+message.slice(0,240));
      await sleep(800*attempt);
    }
  }
  throw last;
}
playwright.chromium.launch=async(...args)=>{
  const browser=await originalLaunch(...args);
  const originalNewContext=browser.newContext.bind(browser);
  browser.newContext=async(...ctxArgs)=>{
    const context=await originalNewContext(...ctxArgs);
    const originalNewPage=context.newPage.bind(context);
    context.newPage=async(...pageArgs)=>{
      const page=await originalNewPage(...pageArgs);
      const originalGoto=page.goto.bind(page);
      const originalReload=page.reload.bind(page);
      page.goto=(inputUrl,options)=>{
        let url=inputUrl;
        if(typeof url==='string'&&url.includes('/#/')){
          const pos=url.indexOf('#');
          const base=url.slice(0,pos);
          const hash=url.slice(pos);
          const sep=base.includes('?')?'&':'?';
          url=base+sep+'shell_cold='+Date.now()+hash;
        }
        return withNavigationRetry(()=>originalGoto(url,navOptions(options)),'goto');
      };
      page.reload=(options)=>withNavigationRetry(()=>originalReload(navOptions(options)),'reload');
      return page;
    };
    return context;
  };
  return browser;
};
