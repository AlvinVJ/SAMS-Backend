import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const distDir = 'lambda_dist';

async function build() {
    console.log('Cleaning built directory...');
    if (fs.existsSync(distDir)) {
        fs.rmSync(distDir, { recursive: true, force: true });
    }
    fs.mkdirSync(distDir);

    console.log('Bundling with esbuild (Firebase externalized)...');
    await esbuild.build({
        entryPoints: ['src/queues/lambda/importantHandler.ts', 'src/queues/lambda/pushHandler.ts'],
        bundle: true,
        platform: 'node',
        target: 'node20',
        outdir: distDir,
        format: 'esm',
        external: [
            'firebase-admin',
            '@google-cloud/firestore',
            'google-gax'
        ],
        banner: {
            js: 'import { createRequire as topLevelCreateRequire } from "module"; const require = topLevelCreateRequire(import.meta.url);'
        },
        minify: true,
    });

    console.log('Generating package.json for Firebase Admin...');
    fs.writeFileSync(path.join(distDir, 'package.json'), JSON.stringify({
        type: "module",
        dependencies: {
            "firebase-admin": "^13.6.0"
        }
    }));

    console.log('Installing firebase-admin native dependencies inside deployment package...');
    execSync('npm install --omit=dev --no-package-lock', { cwd: distDir, stdio: 'inherit' });

    console.log('Copying @prisma runtime dependencies and engines...');
    if (!fs.existsSync(path.join(distDir, 'node_modules'))) {
        fs.mkdirSync(path.join(distDir, 'node_modules'));
    }
    fs.mkdirSync(path.join(distDir, 'node_modules', '@prisma'), { recursive: true });

    const prismaFolders = fs.readdirSync('node_modules/@prisma');
    for (const folder of prismaFolders) {
        if (folder !== 'engines' && folder !== 'generator-helper' && folder !== 'adapter-mssql') {
            fs.cpSync(path.join('node_modules/@prisma', folder), path.join(distDir, 'node_modules/@prisma', folder), { recursive: true });
        }
    }

    if (fs.existsSync('node_modules/.prisma')) {
        fs.cpSync('node_modules/.prisma', path.join(distDir, 'node_modules/.prisma'), { recursive: true });
    }

    console.log('Copying Firebase credentials...');
    fs.copyFileSync('serviceAccountKeys.json', path.join(distDir, 'serviceAccountKeys.json'));

    console.log('Stripping debug symbols and typescript definitions to reduce size...');
    // Strip files we do not need in production to save exactly those 8MB
    execSync('find lambda_dist/node_modules -name "*.d.ts" -type f -delete');
    execSync('find lambda_dist/node_modules -name "*.map" -type f -delete');
    execSync('find lambda_dist/node_modules -name "*.md" -type f -delete');

    console.log('Zipping deployment bundle...');
    if (fs.existsSync('lambda-deploy-final2.zip')) {
        fs.rmSync('lambda-deploy-final2.zip');
    }
    execSync('cd lambda_dist && zip -rqq ../lambda-deploy-final2.zip .');
    console.log('Done! Generated lambda-deploy-final2.zip');
}

build().catch(err => {
    console.error(err);
    process.exit(1);
});
