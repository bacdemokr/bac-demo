'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {GitHubConnection}=require('../app/github-connection');
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function finished(g,id){for(let i=0;i<100;i++){const job=g.forkStatus(id);if(job.status!=='running'&&!g.forking)return job;await wait(2);}throw Error('Fixture fork did not finish.');}
function fixture(calls,{privateSource=false,denied=false}={}){return async(url,options)=>{
 const p=new URL(url).pathname;calls.push({path:p,method:options.method});
 if(p==='/user')return reply({login:'demo-user'});
 if(p==='/search/repositories')return reply({items:[{full_name:'source-owner/source-repo',private:false,description:'Public demo',stargazers_count:12,html_url:'https://github.com/source-owner/source-repo'}]});
 if(p==='/repos/source-owner/source-repo')return reply({private:privateSource,owner:{login:'source-owner'},name:'source-repo',default_branch:'main'});
 if(p.endsWith('/forks'))return denied?reply({error:'private-fixture-token'},403):reply({owner:{login:'demo-user'},name:'demo-fork',fork:true},202);
 if(p.endsWith('/git/ref/heads/main'))return reply({object:{sha:'fixture-sha'}});
 return reply({owner:{login:'demo-user'},name:'demo-fork',private:false,fork:true,parent:{full_name:'source-owner/source-repo'},default_branch:'main',permissions:{push:true}});
};}
test('token alone connects an account without guessing a fixed repository or creating anything',async()=>{
 const calls=[],g=new GitHubConnection({fetcher:fixture(calls)}),state=await g.configure({token:'private-fixture-token'});
 assert(state.connected);assert.equal(state.login,'demo-user');assert.equal(state.repo,'');assert.equal(state.canWrite,false);assert.deepEqual(calls,[{path:'/user',method:'GET'}]);
 const found=await g.repositories('https://github.com/source-owner/source-repo');assert.equal(found.repositories[0].name,'source-owner/source-repo');assert(calls.every(c=>c.method==='GET'));assert(!JSON.stringify(state).includes('private-fixture-token'));
});
test('explicit fork request creates only the selected public source fork, waits for git readiness, and selects the owned fork for work',async()=>{
 const calls=[],g=new GitHubConnection({fetcher:fixture(calls)});await g.configure({token:'private-fixture-token'});
 const job=g.createFork({repository:'source-owner/source-repo'});assert.equal(job.status,'running');
 await assert.rejects(g.configure({disconnect:true}),e=>e.status===409);assert.throws(()=>g.createFork({repository:'source-owner/source-repo'}),e=>e.status===409);
 const done=await finished(g,job.id);assert.equal(done.status,'done');assert.equal(done.repository,'demo-user/demo-fork');assert.equal(done.url,'https://github.com/demo-user/demo-fork');assert.equal(g.public().canWrite,true);
 assert.deepEqual(calls.filter(c=>c.method!=='GET'),[{path:'/repos/source-owner/source-repo/forks',method:'POST'}]);assert(calls.some(c=>c.path==='/repos/demo-user/demo-fork/git/ref/heads/main'));assert(!JSON.stringify(done).includes('private-fixture-token'));
});
test('private sources and permission failures preserve the account, expose no secret, and are never retried as writes',async()=>{
 for(const setup of [{privateSource:true},{denied:true}]){
  const calls=[],g=new GitHubConnection({fetcher:fixture(calls,setup)});await g.configure({token:'private-fixture-token'});
  const job=await finished(g,g.createFork({repository:'source-owner/source-repo'}).id);assert.equal(job.status,'error');assert(!JSON.stringify(job).includes('private-fixture-token'));assert.equal(g.public().repo,'');assert(g.public().connected);
  assert.equal(calls.filter(c=>c.method==='POST').length,setup.privateSource?0:1);
 }
});
