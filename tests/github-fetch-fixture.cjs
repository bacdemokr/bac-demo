// Child-server tests only: GitHub traffic is redirected to a local fixture.
if(!process.env.GITHUB_FIXTURE_URL)throw Error('Local GitHub fixture URL is required.');
const original=global.fetch;
global.fetch=(url,options)=>{
 const target=new URL(String(url));
 return original(target.hostname==='api.github.com'?process.env.GITHUB_FIXTURE_URL+target.pathname+target.search:url,options);
};
