import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.STEER_PLAYWRIGHT_MODULE||'/tmp/steer-review-browser/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.STEER_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const origin=process.env.STEER_PROTOTYPE_ORIGIN||'http://127.0.0.1:3119';
const out=fileURLToPath(new URL('./previews/',import.meta.url));
const errors=[];
const page=await browser.newPage({viewport:{width:1440,height:1040},deviceScaleFactor:1.5});
page.on('pageerror',e=>errors.push(e.message));
const act=async(action,scope='')=>page.locator(`${scope} [data-action="${action}"]`).first().click();
const shot=async(name)=>page.screenshot({path:out+name+'.png',fullPage:true});
for(const c of ['a','b']){
  await page.goto(`${origin}/${c}.html`);
  await page.evaluate(()=>prototype.reset());
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.shell').count(),1);
  await shot(c+'-home');
  await act('connection');
  await page.locator('input[name=url]').fill('invalid');
  await act('verify','.modal');
  assert.match(await page.locator('#connection-error').innerText(),/有效地址/);
  await page.locator('input[name=url]').fill('https://code.byted.org');
  await act('verify','.modal');
  await page.waitForSelector('.modal',{state:'hidden'});
  if(c==='c'){
    await act('next');assert.equal(await page.evaluate(()=>prototype.state.step),1);
    await page.locator('input[name=created]').uncheck();
    await page.locator('input[name=updated]').uncheck();
    await act('next');assert.match(await page.locator('#wizard-error').innerText(),/至少/);
    await page.locator('input[name=created]').check();
    await page.locator('input[name=updated]').check();
    await act('next');
  }else await act('configure');
  await shot(c+'-config');
  await act('rules');
  await page.locator('#rule-editor').fill('');
  await act('publish-confirm','.modal');
  assert.match(await page.locator('#rule-error').innerText(),/不能为空/);
  await page.locator('#rule-editor').fill('# 通用代码审查\n\n检查权限、并发、取消和跨仓库兼容性。\n每条问题必须包含代码位置与触发条件。\n未执行的检查不得记为通过。');
  await shot(c+'-rule');
  await act('save-draft','.modal');
  assert.equal(await page.evaluate(()=>prototype.state.version),'1.4');
  await act('rules');await act('publish-confirm','.modal');
  await shot(c+'-publish');
  await act('publish','.modal');
  assert.equal(await page.evaluate(()=>prototype.state.version),'1.5');
  assert.equal(await page.evaluate(()=>prototype.state.reviewVersion),'1.4');
  if(c==='c'){await act('next');await shot(c+'-output');await act('next')}
  else{
    await page.locator('select[name=effort]').selectOption('xhigh');
    await act('save-config');
    assert.equal(await page.evaluate(()=>prototype.state.effort),'xhigh');
    await act('reports');
    await act('manual');
    await page.locator('input[name=mr]').fill('not a link');
    await act('start','.modal');
    assert.match(await page.locator('#manual-error').innerText(),/有效链接/);
    await page.locator('input[name=mr]').fill('https://code.byted.org/KDF5000/steer/merge_requests/184');
    await act('start','.modal');
  }
  assert.equal(await page.evaluate(()=>prototype.state.running),true);
  await shot(c+'-running');
  await page.waitForFunction(()=>!prototype.state.running);
  if(c==='c')await page.locator('[data-action=review][data-id="184"]').click();
  await shot(c+'-report');
  await act('snapshot');
  assert.match(await page.locator('#modal-title').innerText(),/本次审查/);
  assert.match(await page.locator('.modal-header p').innerText(),/1.5/);
  await page.keyboard.press('Escape');
  await act('feedback');
  assert.equal(await page.evaluate(()=>prototype.state.feedback.f0),'accepted');
  await act('codebase');
  await shot(c+'-codebase');
  assert.equal(await page.locator('.comment').count(),1);
  await page.keyboard.press('Escape');
  await act('scenarios');await act('writeback-fail','.modal');
  await shot(c+'-writeback-failed');
  const count=await page.evaluate(()=>prototype.state.count);
  await act('retry');
  assert.equal(await page.evaluate(()=>prototype.state.count),count);
  assert.equal(await page.evaluate(()=>prototype.state.writeback),'sent');
  await act('scenarios');await act('duplicate','.modal');
  assert.equal(await page.evaluate(()=>prototype.state.count),count);
  await act('scenarios');await act('new-commit','.modal');
  assert.equal(await page.evaluate(()=>prototype.state.outdated),true);
  await shot(c+'-outdated');
  await act('rerun');await page.waitForFunction(()=>!prototype.state.running);
  assert.equal(await page.evaluate(()=>prototype.state.head),'7a8b9c0');
  assert.equal(await page.evaluate(()=>prototype.state.outdated),false);
  await act('scenarios');await act('missing','.modal');
  assert.match(await page.locator('.report-hero').innerText(),/证据不足/);
  await shot(c+'-missing');
  await act('rules');await page.locator('input[name=source][value=repo]').check();
  assert.equal(await page.locator('#rule-editor').getAttribute('readonly'),'');
  await act('sync-rule','.modal');
  assert.equal(await page.evaluate(()=>prototype.state.version),'1.6');
  await act('scenarios');await act('disconnect','.modal');
  await act('verify','.modal');
  assert.match(await page.locator('#connection-error').innerText(),/验证失败/);
  await act('verify','.modal');await page.waitForSelector('.modal',{state:'hidden'});
  await page.reload();assert.equal(await page.evaluate(()=>prototype.state.version),'1.6');
  if(c==='b'){
    await act('reports');await page.locator('#review-search').fill('nothing-matches');
    assert.match(await page.locator('#inbox-rows').innerText(),/没有匹配/);
    await act('clear-filter');
    await page.locator('[data-action=filter][data-value=green]').click();
    assert.equal(await page.locator('#inbox-rows .item-row').count(),1);
  }
  await page.evaluate(()=>prototype.reset());
  console.log(c.toUpperCase()+': connection, draft/publish, review, feedback, writeback retry, new commit, missing checks, repository sync, persistence passed');
}
const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
mobile.on('pageerror',e=>errors.push(e.message));
for(const c of ['a','b']){
 await mobile.goto(`${origin}/${c}.html`);await mobile.evaluate(()=>prototype.reset());
 await mobile.evaluate(()=>document.fonts.ready);
 assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),c+' mobile overflow');
 await mobile.screenshot({path:out+c+'-mobile.png',fullPage:true});
 await mobile.locator('[data-action=rules]').first().click();
 assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),c+' mobile modal overflow');
 const box=await mobile.locator('.modal').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);
 await mobile.screenshot({path:out+c+'-mobile-rules.png',fullPage:true});
 await mobile.keyboard.press('Escape');
 if(c==='c'){for(let i=0;i<3;i++){await mobile.locator('[data-action=next]').click();assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}}
}
await page.goto(origin+'/');await page.evaluate(()=>document.fonts.ready);await shot('comparison');
await page.setViewportSize({width:1800,height:1240});
for(const c of ['a','b']){await page.goto(origin+'/flow.html?concept='+c);await page.evaluate(()=>document.fonts.ready);await shot(c+'-flow');}
assert.equal(errors.length,0,errors.join('\n'));
await browser.close();
console.log('Desktop and 390px layout checks passed; no JavaScript errors.');

await import('./capture-c.mjs');
