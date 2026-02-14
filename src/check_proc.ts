
import { firestore } from '../src/config/firebase.js';

async function checkPlacementProcedure() {
    console.log("--- CHECKING PLACEMENT ATTENDANCE PROCEDURE IN FIRESTORE ---");

    const snapshot = await firestore.collection("procedures")
        .where("title", "==", "Placement Attendance")
        .get();

    if (snapshot.empty) {
        console.log("No procedure found with title 'Placement Attendance'");
        return;
    }

    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`\nID: ${doc.id}`);
        console.log(`Title: ${data.title}`);
        console.log(`System Hook: ${data.system_hook}`);
        console.log("Fields:");
        const fields = data.formFields || data.formSchema || data.formBuilder || [];
        fields.forEach((f: any) => {
            console.log(` - Label: ${f.label}, ID: ${f.fieldId || f.id}, Type: ${f.type}`);
        });
    });

    console.log("\n--- END ---");
}

checkPlacementProcedure()
    .catch(e => console.error(e))
    .finally(() => process.exit(0));
