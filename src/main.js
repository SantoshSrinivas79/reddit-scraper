const Apify = require('apify');
const Parsers = require('./parsers');
const { log, getUrlType, getSearchUrl, gotoFunction } = require('./tools');
const { EnumURLTypes } = require('./constants');

Apify.main(async () => {
    const input = await Apify.getInput();

    const { proxy, startUrls, searches, extendOutputFunction, maxPostCount, maxComments, useBuiltInSearch, type } = input;

    if (!startUrls && !useBuiltInSearch) {
        throw new Error('startUrls or built-in search must be used!');
    }

    const requestList = await Apify.openRequestList('start-urls', useBuiltInSearch ? [] : startUrls.map((url) => ({ url })));
    const requestQueue = await Apify.openRequestQueue();

    if (useBuiltInSearch) {
        for (const search of searches) {
            await requestQueue.addRequest({ url: getSearchUrl({ search, type }) });
        }
    }

    const crawler = new Apify.PuppeteerCrawler({
        requestList,
        requestQueue,
        useSessionPool: true,
        persistCookiesPerSession: true,
        launchPuppeteerOptions: {
            ...proxy,
            stealth: true,
        },

        gotoFunction,

        handlePageFunction: async (context) => {
            const dataset = await Apify.openDataset();
            const { itemCount } = await dataset.getInfo();

            if (itemCount >= maxPostCount) {
                log.info('Actor reached the max items limit. Crawler is going to halt...');
                log.info('Crawler Finished.');
                process.exit();
            }

            const { page, request } = context;
            log.info(`Processing ${request.url}...`);

            const urlType = getUrlType(request.url);
            log.debug(`Type: ${urlType}`);

            await Apify.utils.puppeteer.injectJQuery(page);

            switch (urlType) {
                case EnumURLTypes.POSTS:
                    return Parsers.postsParser({ requestQueue, ...context, maxPostCount });
                case EnumURLTypes.COMUMUNITIES_AND_USERS:
                    return Parsers.communitiesAndUsersParser({ requestQueue, ...context });
                case EnumURLTypes.COMMENTS:
                    return Parsers.commentsParser({ requestQueue, ...context, extendOutputFunction });
                case EnumURLTypes.COMMUNITY:
                    return Parsers.communityParser({ requestQueue, ...context, maxComments });
                case EnumURLTypes.COMMUNITY_CATEGORY:
                    return Parsers.communityCategoryParser({ requestQueue, ...context, maxPostCount, extendOutputFunction });
                default:
                    log.warning('Url does not match any parser');
            }
        },

        handleFailedRequestFunction: async ({ request }) => {
            log.exception(`Request ${request.url} failed too many times`);
        },
    });

    log.info('Starting the crawl.');
    await crawler.run();
    log.info('Crawl finished.');
});
