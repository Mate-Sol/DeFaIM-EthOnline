require('dotenv').config();
const mongoose = require('mongoose');

// Define a temporary schema that accepts both string and array for migration purposes
const migrationSchema = new mongoose.Schema({
    companyName: String,
    walletAddress: mongoose.Schema.Types.Mixed
}, { collection: 'pspprofiles' });

const MigrationProfile = mongoose.model('MigrationProfile', migrationSchema);

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB Connected');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

const migrateWallets = async () => {
    try {
        console.log('🚀 Starting walletAddress migration...');
        const profiles = await MigrationProfile.find({});
        let updatedCount = 0;
        let skippedCount = 0;

        for (const profile of profiles) {
            const currentWallet = profile.walletAddress;

            // Case 1: walletAddress is a non-empty string
            if (typeof currentWallet === 'string' && currentWallet.trim() !== '') {
                console.log(`Migrating string wallet for: ${profile.companyName}`);
                const oldAddress = currentWallet;
                profile.walletAddress = [{ name: 'Primary Wallet', address: oldAddress }];
                await profile.save();
                updatedCount++;
            } 
            // Case 2: walletAddress is null, undefined, or empty string
            else if (!currentWallet || currentWallet === '') {
                console.log(`Initializing empty wallet array for: ${profile.companyName}`);
                profile.walletAddress = [];
                await profile.save();
                updatedCount++;
            }
            // Case 3: already an array, but maybe needs name/address structure check if it was just [string]
            else if (Array.isArray(currentWallet)) {
                let modified = false;
                const newWallets = currentWallet.map((w, index) => {
                    if (typeof w === 'string') {
                        modified = true;
                        return { name: `Wallet ${index + 1}`, address: w };
                    }
                    return w;
                });

                if (modified) {
                    console.log(`Fixing array structure for: ${profile.companyName}`);
                    profile.walletAddress = newWallets;
                    await profile.save();
                    updatedCount++;
                } else {
                    skippedCount++;
                }
            }
            else {
                skippedCount++;
            }
        }

        console.log(`✅ Migration completed!`);
        console.log(`📊 Total: ${profiles.length}`);
        console.log(`✨ Updated: ${updatedCount}`);
        console.log(`⏭️  Skipped: ${skippedCount}`);
    } catch (error) {
        console.error('❌ Migration error:', error);
    } finally {
        await mongoose.connection.close();
        console.log('Database connection closed');
        process.exit(0);
    }
};

connectDB().then(() => migrateWallets());
