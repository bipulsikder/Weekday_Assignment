// Task 1: Data Splitting Script console.log("Starting script...");

let table = base.getTable("Interview Rounds"); let query = await table.selectRecordsAsync();

console.log("Total records:", query.records.length);

for (let record of query.records) { let rawData = record.getCellValue("Scheduling method (Raw)");

if (rawData) {
    console.log("Processing record:", record.getCellValue("Candidate Email"));
    console.log("Raw data:", rawData);
    
    // Find all Calendly links
    let lines = rawData.split('\n');
    let links = [];
    
    for (let line of lines) {
        if (line.includes('calendly.com')) {
            let match = line.match(/(https:\/\/calendly\.com\/[^\s]+)/);
            if (match) {
                links.push(match[1]);
            }
        }
    }
    
    console.log("Found", links.length, "links");
    
    if (links.length > 1) {
        console.log("Will split into", links.length, "records");
        
        // Create new records for each round
        for (let i = 0; i < links.length; i++) {
            let roundNumber = null;
            
            if (i === 0) roundNumber = {id: "selpTbidvz30LfoDh"}; // Round1
            if (i === 1) roundNumber = {id: "sel0IIb0FbxCkVhjT"}; // Round2  
            if (i === 2) roundNumber = {id: "selcRIpRkl5hgKYai"}; // Round3
            if (i === 3) roundNumber = {id: "selRR21Tl0u8cCBcb"}; // Round4
            if (i === 4) roundNumber = {id: "selrWis2B8avA4fk7"}; // Round5
            
            let newRecord = {
                "Interviewer Email": record.getCellValue("Interviewer Email"),
                "Interviewer": record.getCellValue("Interviewer"),
                "Company": record.getCellValue("Company"), 
                "Candidate": record.getCellValue("Candidate"),
                "Candidate Email": record.getCellValue("Candidate Email"),
                "Round Number": roundNumber,
                "Calendly Link": links[i],
                "Scheduling method (Raw)": rawData,
                "Added On": record.getCellValue("Added On")
            };
            
            await table.createRecordAsync(newRecord);
            console.log("Created round", i+1, "for", record.getCellValue("Candidate Email"));
        }
        
        // Delete original record
        await table.deleteRecordAsync(record.id);
        console.log("Deleted original record");
        
    } else if (links.length === 1) {
        // Update single round record
        await table.updateRecordAsync(record.id, {
            "Round Number": {id: "selpTbidvz30LfoDh"}, // Round1
            "Calendly Link": links[0]
        });
        console.log("Updated single round record");
    }
}
}

console.log("Script completed!");