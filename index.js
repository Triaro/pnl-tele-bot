const express = require('express');
const ttService = require("./service/TradetronService");
const gSheetService = require("./service/GoogleService");
const quoteService = require("./service/QuoteService");
const publisherService = require("./service/PublisherService");
const appConfig = require("./config");
const utils = require('./utils');

let app = express();
app.use(express.json()); //to parse body

console.info(`START : Application fully loaded at ${utils.getDateTimestamp()}`);

//Compute holiday checker once a day or on server restart and is cached
let isTodayHoliday = utils.isHoliday();

if (isTodayHoliday) {
    console.info("Its is a holiday, so lets hope no workers work today");
}

//Middleware to log the request
let requestMW = (req, res, next) => {
    console.log("called");
    console.log(`Incoming request ${req.path} from ${req.hostname} ${JSON.stringify(req.query)} at ${utils.getDateTimestamp()}`);
    next();
}

app.use(requestMW);

//Middleware to check auth
let authorizedMW = (req, res, next) => {
    if (req.headers.authorization) {
        const base64Credentials = req.headers.authorization.split(' ')[1];
        const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
        const [username, password] = credentials.split(':');
        if (username === appConfig.app.API_USER && password === appConfig.app.API_PWD) {
            return next()
        }
    }

    return res.status(401).json({ status: 'Unauthorized in tt-pnl app', message: 'Not authorized to access this api' });
}

//Middleware to check holiday and trade working hours
let tradeTimeCheckerMW = (req, res, next) => {
    if (!isTodayHoliday && utils.withinTradingHours()) {
        return next()
    }
    console.error(`Request in holiday or outside trade window`);
    return res.status(200).send({ status: 'Not processed', message: `Request in holiday or outside trade window` });
}

let bodyCheckerMW = (req, res, next) => {
    let { tradeType, creatorId } = req.query;
    if (tradeType != undefined && creatorId != undefined) {
        return next();
    }
    console.error(`Incomplete request. Pass trade Type and creator ID`);
    return res.status(400).send({ status: 'Incomplete request. Pass trade Type and creator ID' });
}

let bodyChecker2MW = (req, res, next) => {
    let { gSheetId } = req.query;
    if (gSheetId != undefined) {
        return next();
    }
    console.error(`Incomplete request. Pass spreadsheet ID`);
    return res.status(400).send({ status: 'Incomplete request. Pass spreadsheet ID' });
}

let bodyChecker3MW = (req, res, next) => {
    let { telegramChatId } = req.query;
    if (telegramChatId != undefined) {
        return next();
    }
    console.error(`Incomplete request. Pass Telegram Chat ID`);
    return res.status(400).send({ status: 'Incomplete request. Pass Telegram Chat ID' });
}


//Routes with middlewares
 app.post('/pnl-telegram', authorizedMW, tradeTimeCheckerMW, bodyCheckerMW, bodyChecker3MW,
    async (req, res) => {        
        const { tradeType, creatorId, telegramChatId } = req.query;
        ttService.Deployments({ tradeType, creatorId }).then(result => {
            message = utils.deploymentsFormattedText(result, tradeType);
            publisherService.Publish({ transporter: appConfig.app.TELEGRAM, message: message, chatId: telegramChatId });
        }).catch(e => {
            console.log(e);
            publisherService.Publish({ transporter: appConfig.app.TELEGRAM, message: e.message, chatId: appConfig.telegram.debugChatId });
        });

        res.json({ status: 'Ok', message: `PNL request is accepted at ${new Date().toString()}` });
    });

app.post('/pnl-gsheet', authorizedMW, tradeTimeCheckerMW, bodyCheckerMW, bodyChecker2MW,
    async (req, res, next) => {
        const { tradeType, creatorId, gSheetId } = req.query;
        ttService.Deployments({ tradeType, creatorId }).then(result => {
            publisherService.Publish({ transporter: appConfig.app.GSHEET, data: result, gSheetId: gSheetId });
        }).catch(e => {
            console.log(e.message);
            publisherService.Publish({ transporter: appConfig.app.TELEGRAM, message: e.message, chatId: appConfig.telegram.debugChatId });
        });

        res.json({ status: 'Ok', message: `Google Sheet update request is accepted at ${utils.getDateTimestamp()}` });
    });

app.post('/tt-daySetup', authorizedMW, bodyChecker2MW,
    async (req, res, next) => {
        //One time setup, this should be called everyday once.
        isTodayHoliday = utils.isHoliday();

        //Create the google sheet for today
        const { gSheetId } = req.query;
        gSheetService.CreateSheet({ gSheetId: gSheetId }).then(result => {
            publisherService.Publish({ transporter: appConfig.app.TELEGRAM, message: `Daily Sheet creation successful for ${gSheetId}`, chatId: appConfig.telegram.debugChatId });
        }).catch(e => {
            console.log(e.message);
            publisherService.Publish({ transporter: appConfig.app.TELEGRAM, message: e.message, chatId: appConfig.telegram.debugChatId });
        });

        return res.json({ status: 'Ok', message: `Google sheet init is accepted at ${utils.getDateTimestamp()}` });
    });

/*
    cron-job.org POST call is not sending body hence resorting to queryparams
    /tokenTest?tradeType=PAPER+TRADING&creatorId=10000
*/
app.post('/tokenTest', authorizedMW, bodyCheckerMW,
    async (req, res, next) => {
        //Test call to get all deployments
        const { tradeType, creatorId } = req.query;
        ttService.Deployments({ tradeType, creatorId }).then(result => {
            return res.status(200).send({ status: 'Ok', message: `TT Token is working at ${utils.getDateTimestamp()}` });
        }).catch(e => {
            console.log(e.message);
            publisherService.Publish({ transporter: appConfig.app.TELEGRAM, message: e.message, chatId: appConfig.telegram.debugChatId });
            return res.status(401).send({ status: 'Not Ok', message: e.message });
        });
    });

/* Mandatory to have telegramChatId in the request query params */
app.post('/qod-telegram', authorizedMW, bodyChecker3MW,
    async (req, res, next) => {
        const { telegramChatId } = req.query;
        quoteService.GetQuoteOfDay().then(quoteObj => {
            if (quoteObj) {
                let message = utils.quoteFormattedText(quoteObj);
                publisherService.Publish({ transporter: appConfig.app.TELEGRAM, message: message, chatId: telegramChatId });
            } else {
                let err = 'Error in Quote Service, empty data set';
                console.log(err);
                publisherService.Publish({ transporter: appConfig.app.TELEGRAM, message: err, chatId: appConfig.telegram.debugChatId });
            }
        })
        return res.json({ status: 'Ok', message: `Quote request is accepted at ${utils.getDateTimestamp()}` });
    });

app.listen(process.env.PORT, function(){

});
