import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";
import { createEmailTemplate } from "./emailTemplate.js";

// Load .env.local if it exists, otherwise default to .env
if (fs.existsSync(".env.local")) {
    dotenv.config({ path: ".env.local" });
} else {
    dotenv.config();
}

// ---------------- CONFIG ----------------
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL;
const FROM_NAME = process.env.FROM_NAME;

// ----------------------------------------

const AIRTABLE_URL = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;

async function getRecords() {
    const res = await fetch(AIRTABLE_URL, {
        headers: {
            Authorization: `Bearer ${AIRTABLE_API_KEY}`
        }
    });
    
    if (!res.ok) {
        const errorText = await res.text();
        console.error(`❌ Airtable API Error: ${res.status} ${res.statusText}`);
        console.error(`Response body: ${errorText}`);
        throw new Error(`Airtable API failed with status ${res.status}`);
    }

    const data = await res.json();
    if (!data.records) {
        console.error("❌ Unexpected response format from Airtable (missing 'records' field):", JSON.stringify(data, null, 2));
        return { records: [] }; // Return empty structure to prevent crash
    }
    return data;
}

async function updateRecord(recordId) {
    await fetch(`${AIRTABLE_URL}/${recordId}`, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${AIRTABLE_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            fields: {
                "Mail Sent Time": new Date().toISOString()
            }
        })
    });
}

async function sendEmail(emailData) {
    return fetch("https://api.mailersend.com/v1/email", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${MAILERSEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(emailData)
    });
}

// ---------------- MAIN ----------------
async function run() {
    console.log("🚀 Starting email job...");

    const data = await getRecords();
    console.log(`📊 Records found: ${data.records.length}`);

    for (const record of data.records) {

        const f = record.fields;

        if (f["Mail Sent Time"]) continue;
        if (!f["Candidate Email"] || !f["Calendly Link"]) continue;

        const emailData = {
            from: {
                email: FROM_EMAIL,
                name: FROM_NAME
            },
            to: [{
                email: f["Candidate Email"],
                name: f["Candidate"]?.[0]?.name || "Candidate"
            }],
            subject: `Interview Invitation - ${f["Round Number"]?.name || "Round 1"}`,
            html: createEmailTemplate(
                f["Candidate"]?.[0]?.name || "Candidate",
                f["Company"]?.[0]?.name || "Our Team",
                f["Interviewer"]?.[0]?.name || "Our Team",
                f["Round Number"]?.name || "Round 1",
                f["Calendly Link"]
            )
        };

        try {
            const res = await sendEmail(emailData);

            if (res.ok) {
                await updateRecord(record.id);
                console.log(`✅ Sent: ${f["Candidate Email"]}`);
            } else {
                const errorText = await res.text();
                console.log(`❌ Failed: ${f["Candidate Email"]} - Status: ${res.status} - Response: ${errorText}`);
            }
        } catch (err) {
            console.log(`❌ Error: ${err.message}`);
        }

        // rate limit
        await new Promise(r => setTimeout(r, 1500));
    }

    console.log("🎉 Job finished");
}

run().catch(err => {
    console.error("\n💥 Critical Job Failure:");
    console.error(err.message);
    process.exit(1);
});
