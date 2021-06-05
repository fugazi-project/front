const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const fetchSpreadsheet = require('./lib/fetch-spreadsheet');
const fetchBountyTasks = require('./lib/fetch-bounty-tasks');

const weekNos = _.range(34, 53).map(weekNo => `Week ${weekNo}`);

async function createBountyTasks() {
    let bountyTasks = await fetchBountyTasks();

    for (let task of bountyTasks) {
        task.totalStakes = 0;
        task.totalTokens = 0;
    }

    return bountyTasks;
}

function parseCampaigns(groupedWeek) {
    return groupedWeek.reduce((acc, cur) => {
        const campaignGroups = [
            'Twitter Campaign',
            'Telegram Campaign',
            'Facebook Campaign',
            'Bitcointalk Campaign',
            'LinkedIn Campaign',
            'Reddit Campaign',
            'Creative Campaign',
        ];

        campaignGroups.forEach(campaignGroup => {
            if (!cur[campaignGroup]) {
                return;
            }

            cur[campaignGroup].split(',').forEach(campaign => {
                let normalizedCampaign = campaign.substring(0, campaign.indexOf(':')).trim();

                //if (!campaigns.includes(normalizedCampaign)) {
                //    console.warn(`Invalid Campaign "${normalizedCampaign}"`);
                //    return;
                //}

                acc[normalizedCampaign] = {done: true};
            });
        });

        return acc;
    }, {});
}

function parseWeekNo(weekNo) {
    let result;

    const parsed = parseInt(weekNo);
    if (isNaN(parsed)) {
        result = weekNo.substring(0, 7);
    } else {
        switch (parsed) {
            case 1:
                result = 'Week 23';
                break;
            case 2:
                result = 'Week 24';
                break;
            case 3:
                result = 'Week 25';
                break;
            default:
                throw Error(`Could not parse weekNo "${parsed}"`);
        }
    }

    if (!weekNos.includes(result)) {
        throw Error(`Invalid weekNo "${result}"`);
    }

    return result;
}

function transformData(input) {
    const groupedByAddr = _.groupBy(input, 'ERC-20 Wallet Address');

    const reports = Object.keys(groupedByAddr).map(addr => {
        const groupedWeek = _.groupBy(groupedByAddr[addr], 'Week Number');
        return {
            address: addr,
            weeks: Object.keys(groupedWeek).map(weekNo => {
                return {
                    weekNo: weekNo,
                    parsedWeekNo: parseWeekNo(weekNo),
                    campaigns: parseCampaigns(groupedWeek[weekNo])
                }
            })
        };
    });

    // Every Ethereum address that used the report form
    // is part of the airdrop campaign too.
    reports.forEach(report => {
        report.weeks[0].campaigns['AIRDROP01'] = {done: true};
    });

    return reports;
}

function calcRewards(output) {
    output.summary = {
        totalAsrTokens: 2000000,
        totalTokens: 0,
        totalStakes: 0
    };

    for (let member of output.data) {
        member.stakes = 0;
        member.tokens = 0;

        const airdropTask = output.bountyTasks.find(t => t.id === "AIRDROP01");
        if (airdropTask) {
            member.stakes += Number(airdropTask.reward);
            airdropTask.totalStakes += Number(airdropTask.reward);
            output.summary.totalStakes += Number(airdropTask.reward);
        }

        for (let week of member.weeks) {
            for (let campaignName of Object.keys(week.campaigns)) {
                const campaign = week.campaigns[campaignName];
                const task = output.bountyTasks.find(t => t.id === campaignName);
                if (campaign.done && task) {
                    if (task.rewardType === "Stakes" && task.frequency === "Weekly") {
                        member.stakes += Number(task.reward);
                        task.totalStakes += Number(task.reward);
                        output.summary.totalStakes += Number(task.reward);
                    } else if (task.rewardType === "Tokens" && task.frequency === "Submission") {
                        member.tokens += Number(task.reward);
                        task.totalTokens += Number(task.reward);
                        output.summary.totalTokens += Number(task.reward);
                    }
                } else {
                    console.warn("task not found!");
                }
            }
        }
    }

    output.summary.stakesAsrTokens = output.summary.totalAsrTokens - output.summary.totalTokens;
    output.summary.asrTokenPerStake = output.summary.stakesAsrTokens / output.summary.totalStakes;
    for (const member of output.data) {
        member.summary = {
            totalTokens: member.tokens + ((member.stakes || 0) * output.summary.asrTokenPerStake),
            campaigns: output.bountyTasks.map((task) => {
                const campaignDoneCount = member.weeks.filter(week => week.campaigns[task.id] && week.campaigns[task.id].done).length;
                let campaignTokens = 0;
                if (task.rewardType === "Stakes" && task.frequency === "Once") {
                    campaignTokens = task.reward * output.summary.asrTokenPerStake;
                } else if (task.rewardType === "Stakes" && task.frequency === "Weekly") {
                    campaignTokens = campaignDoneCount * task.reward * output.summary.asrTokenPerStake;
                } else if (task.rewardType === "Tokens" && task.frequency === "Submission") {
                    campaignTokens = campaignDoneCount * task.reward;
                }
                
                return {
                    campaign: task.id,
                    count: campaignDoneCount,
                    tokens: campaignTokens
                };
            }).filter(campaign => campaign.count > 0)
        };
        member.summary.campaigns = _.orderBy(member.summary.campaigns, ['tokens'], ['desc']);
    }

    output.data = _.orderBy(output.data, ['summary.totalTokens'], ['desc'])
}

function printStatistics(output) {
    let totalCampaigns = 0;
    for (const member of output.data) {
        for (const week of member.weeks) {
            totalCampaigns += Object.keys(week.campaigns).length
        }
    }

    console.log(`Total Bounty Members: ${output.data.length}, Total Campaigns: ${totalCampaigns}`);
    console.log(`Total ASR: ${output.summary.totalAsrTokens}, Total Token ASR: ${output.summary.totalTokens}, Total Stakes ASR: ${output.summary.stakesAsrTokens}, Total Stakes ${output.summary.totalStakes}, 1 Stake = ${output.summary.asrTokenPerStake} ASR`);

    console.log(`Total tokens spend: ${_.sumBy(output.data, 'summary.totalTokens')}, Tokens: ${_.sumBy(output.data, 'tokens')}, Stakes; ${_.sumBy(output.data, 'stakes')}`);
    for (let i = 0; i < output.data.length; i++) {
        const member = output.data[i];
        console.log(`${i} ETH addr: ${member.address}, ASR: ${member.summary.totalTokens}, (Tokens: ${member.tokens}, Stakes: ${member.stakes})`);
        //console.table(member.summary.campaigns);
    }
}

function flattenOutput(output) {
    const convertFloat = f => f.toString().replace('.', ',');
    
    return _.flatten(output.data.map(member => {
       return member.summary.campaigns.map(campaign => {
           return {
               bountyTotalAsrTokens: convertFloat(output.summary.totalAsrTokens),
               bountyTotalAsrTokensForStakes: convertFloat(output.summary.stakesAsrTokens),
               bountyTotalStakes: convertFloat(output.summary.totalStakes),
               bountyAsrTokenPerStake: convertFloat(output.summary.asrTokenPerStake),
               hunterEthAddress: member.address,
               hunterTotalAsrTokens: convertFloat(member.summary.totalTokens),
               campaign: campaign.campaign,
               count: campaign.count,
               tokens: convertFloat(campaign.tokens)
           }
       });
    }));
}

function exportAsJSON(data) {
    const result = data.data.map(member => {
        return {
            address: member.address,
            totalTokens: member.summary.totalTokens 
        };
    });
    
    fs.writeFileSync('output-bounty-reports.json', JSON.stringify(result, null, 2));
}

function exportAsCsv(data) {
    const csvWriter = createCsvWriter({
        path: 'output-bounty-reports.csv',
        fieldDelimiter: ';',
        header: [
            {id: 'bountyTotalAsrTokens', title: '[BOUNTY] Total ASR Tokens'},
            {id: 'bountyTotalAsrTokensForStakes', title: '[BOUNTY] Total ASR Tokens For Stakes'},
            {id: 'bountyTotalStakes', title: '[BOUNTY] Total Stakes'},
            {id: 'bountyAsrTokenPerStake', title: '[BOUNTY] ASR Token Per Stake'},
            {id: 'hunterEthAddress', title: '[HUNTER] ETH Address'},
            {id: 'hunterTotalAsrTokens', title: '[HUNTER] Total ASR Tokens'},
            {id: 'campaign', title: 'Campaign'},
            {id: 'count', title: 'Count'},
            {id: 'tokens', title: 'Tokens'},
        ]
    });

    return csvWriter.writeRecords(data);
}

function parseBountyReports(rows) {
    const headers = rows.shift();

    const reports = rows.map((row) => _.zipObject(headers, row));
    for (let report of reports) {
        // TODO: We lose the address checksum if we convert to lower case ...
        report['ERC-20 Wallet Address'] = report['ERC-20 Wallet Address'].trim().toLowerCase();
    }

    return reports;
}

function updateHarpData(bountyReports) {
    const harpDataFile = path.join(__dirname, '../src/bounty/_data.json');
    const harpData = JSON.parse(fs.readFileSync(harpDataFile, 'utf-8'));

    harpData.index.bountyReports = bountyReports;

    fs.writeFileSync(harpDataFile, JSON.stringify(harpData, null, 2));
}

(async () => {
    try {
        const bountyTasks = await createBountyTasks();
        const res = await fetchSpreadsheet({
            spreadsheetId: '1t24TcE14RAVoCqxvIaid8xIxwYgRL2IKidkKllvOzJY',
            range: 'BountyHunter Reports',
        });

        const rows = res.data.values;
        if (rows.length) {
            const bountyReports = parseBountyReports(rows);

            const blacklist = [];
            const blacklisted = bountyReport => !blacklist.includes(bountyReport['ERC-20 Wallet Address']);

            const transformedBountyReports = transformData(bountyReports.filter(blacklisted));
            const output = {
                created: new Date().toISOString(),
                weekNos: weekNos,
                data: transformedBountyReports,
                bountyTasks: bountyTasks
            };

            calcRewards(output);
            printStatistics(output);
            exportAsJSON(output);
            await exportAsCsv(flattenOutput(output));
            updateHarpData(output);
            console.log('Done.');
        } else {
            console.log('No data found.');
        }
    } catch (err) {
        console.log('The API returned an error: ' + err)
    }
})();
