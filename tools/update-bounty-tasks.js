// See https://developers.google.com/sheets/api/quickstart/nodejs?authuser=1

const fs = require('fs');
const path = require('path');
const fetchBountyTasks = require('./lib/fetch-bounty-tasks');

function updateHarpData(bountyTasks) {
    const harpDataFile = path.join(__dirname, '../src/bounty/_data.json');
    const harpData = JSON.parse(fs.readFileSync(harpDataFile, 'utf-8'));

    harpData.index.ui = bountyTasks;

    fs.writeFileSync(harpDataFile, JSON.stringify(harpData,null, 2));
}

(async () => {
   try {
       const bountyTasks = await fetchBountyTasks();
       
       if (bountyTasks.length) {
           updateHarpData(bountyTasks);
           console.log('Done.');
       } else {
           console.log('No data found.');
       }
   } catch (err) {
       console.log('The API returned an error: ' + err)
   }
})();