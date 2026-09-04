from pathlib import Path

p = Path('scripts/web-shell-consistency-e2e.cjs')
s = p.read_text()
old = '''async function assertDashboardRenderer(page,route){
  if(route==='overview'){
    await page.waitForSelector('.v5-root.v5-overview',{timeout:12000});
    const old=await page.locator('.workflow-v3-dashboard,.v4-report').count();
    if(old)throw new Error('DASHBOARD_RENDERER_REGRESSION_overview_old_renderer='+old);
    const text=(await page.locator('#content').innerText()).replace(/\\s+/g,' ');
    if(!/Cần xử lý|Needs action/.test(text)||!/SKU ưu tiên|Priority SKUs/.test(text))throw new Error('DASHBOARD_V5_OVERVIEW_MARKERS_MISSING:'+safe(text));
    console.log('DASHBOARD_V5_RUNTIME=PASS route=overview');
  }
  if(route==='reports'){
    await page.waitForSelector('.v5-root.v5-report',{timeout:12000});
    const old=await page.locator('.workflow-v3-dashboard,.v4-report').count();
    if(old)throw new Error('DASHBOARD_RENDERER_REGRESSION_reports_old_renderer='+old);
    const text=(await page.locator('#content').innerText()).replace(/\\s+/g,' ');
    if(!/Tổng hợp|Summary/.test(text)||!/Tốc độ & SLA|Speed & SLA/.test(text)||!/Cơ cấu kết quả|Outcome mix/.test(text))throw new Error('DASHBOARD_V5_REPORT_MARKERS_MISSING:'+safe(text));
    console.log('DASHBOARD_V5_RUNTIME=PASS route=reports');
  }
}
'''
new = '''async function assertDashboardRenderer(page,route){
  if(route==='overview'){
    await page.waitForSelector('.v5-root.v5-overview',{timeout:12000});
    await page.waitForFunction(()=>{const root=document.querySelector('.v5-root.v5-overview'),text=(document.querySelector('#content')?.innerText||'').replace(/\\s+/g,' ');return Boolean(root)&&(/Cần xử lý|Needs action/.test(text))&&(/SKU ưu tiên|Priority SKUs/.test(text));},null,{timeout:12000});
    const old=await page.locator('.workflow-v3-dashboard,.v4-report').count();
    if(old)throw new Error('DASHBOARD_RENDERER_REGRESSION_overview_old_renderer='+old);
    console.log('DASHBOARD_V5_RUNTIME=PASS route=overview ready=true legacy=false');
  }
  if(route==='reports'){
    await page.waitForSelector('.v5-root.v5-report',{timeout:12000});
    await page.waitForFunction(()=>{const root=document.querySelector('.v5-root.v5-report'),text=(document.querySelector('#content')?.innerText||'').replace(/\\s+/g,' ');return Boolean(root)&&(/Tổng hợp|Summary/.test(text))&&(/Tốc độ & SLA|Speed & SLA/.test(text))&&(/Cơ cấu kết quả|Outcome mix/.test(text));},null,{timeout:12000});
    const old=await page.locator('.workflow-v3-dashboard,.v4-report').count();
    if(old)throw new Error('DASHBOARD_RENDERER_REGRESSION_reports_old_renderer='+old);
    console.log('DASHBOARD_V5_RUNTIME=PASS route=reports ready=true legacy=false');
  }
}
'''
if s.count(old) != 1:
    raise SystemExit(f'ASSERT_RENDERER_BLOCK_COUNT={s.count(old)}')
p.write_text(s.replace(old, new, 1))

p = Path('web-admin/index.html')
s = p.read_text()
old = '    <!-- Overview + Reports V5 is imported directly by main.js to guarantee renderer authority. -->\n'
new = '    <!-- Overview + Reports V5 is imported directly by main.js; production acceptance waits for fully rendered V5 content. -->\n'
if s.count(old) != 1:
    raise SystemExit(f'INDEX_MARKER_COUNT={s.count(old)}')
p.write_text(s.replace(old, new, 1))
