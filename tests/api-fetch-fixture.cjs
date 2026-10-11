// Child-process tests only. Provider authentication is confined to a local fixture.
if (!process.env.API_FIXTURE_URL) throw Error('Local API fixture URL is required.');
const original = global.fetch;
global.fetch = (url, options) => {
  const target = new URL(String(url));
  return original(['api.github.com', 'api.telegram.org', 'api.agentmail.to'].includes(target.hostname) ? process.env.API_FIXTURE_URL + target.pathname + target.search : url, options);
};
