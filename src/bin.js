#!/usr/bin/env node
"use strict";

import * as fs from "fs"
import nopt from "nopt"
import transform from "./index.js"

const options = nopt({
    'format': String,
    'input': String,
    'output': String,
}, {
    'f': ['--format'],
    'i': ['--input'],
    'o': ['--output'],
});

let blueprint = "";
const source = options.input ? fs.createReadStream(options.input) : process.stdin;

source.on("data", chunk => {
    blueprint += chunk;
});

source.on("end", () => {
    const opts = {
        format: options.format,
    };

    try {
        const result = transform(blueprint, opts);
        const out = JSON.stringify(result);

        if (options.output) {
            fs.writeFileSync(options.output, out);
        } else {
            console.log(out);
        }
    } catch (e) {
        console.log("Error transforming the API Blueprint: ");
        console.log(e);
        process.exit(1);
    }
});