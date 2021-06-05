// See https://developers.google.com/sheets/api/quickstart/nodejs?authuser=1

const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const fetchSpreadsheet = require('./fetch-spreadsheet');
const {camelize} = require('./utils');

function parseBountyTasks(rows) {
    const headers = rows.shift().map(camelize);

    return rows.map((row) => {
        const bountyTask = _.zipObject(headers, row);
        bountyTask.rules = bountyTask.rules.split('\n').filter(r => r !== '');
        return bountyTask;
    });
}

module.exports = async function fetchBountyTasks() {
    const res = await fetchSpreadsheet({
        spreadsheetId: '1t24TcE14RAVoCqxvIaid8xIxwYgRL2IKidkKllvOzJY',
        range: 'Tasks',
    });

    const rows = res.data.values;
    if (rows.length) {
        return parseBountyTasks(rows);
    } else {
        return [];
    }
};