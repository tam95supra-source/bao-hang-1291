'use strict';
const playwright=require('playwright-core');
const originalLaunch=playwright.chromium.launch.bind(playwright.chromium);
playwright.chromium.launch=async(...args)=>{
  const browser=await originalLaunch(...args);
  const originalNewContext=browser.newContext.bind(browser);
  browser.newContext=async(...ctxArgs)=>{
    const context=await originalNewContext(...ctxArgs);
    const originalNewPage=context.newPage.bind(context);
    context.newPage=async(...pageArgs)=>{
      const page=await originalNewPage(...pageArgs);
      const originalGoto=page.goto.bind(page);
      page.goto=(url,options)=>{
        if(typeof url==='string'&&url.includes('/#/')){
          const pos=url.indexOf('#');
          const base=url.slice(0,pos);
          const hash=url.slice(pos);
          const sep=base.includes('?')?'&':'?';
          url=base+sep+'shell_cold='+Date.now()+hash;
        }
        return originalGoto(url,options);
      };
      return page;
    };
    return context;
  };
  return browser;
};
