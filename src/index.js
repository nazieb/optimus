import swagger from "./formatters/swagger"
import ast from "./formatters/ast"

export default function transform(blueprint, opts = {}) {
    let result;

    switch (opts.format) {
        case "swagger":
            result = swagger(blueprint);
            break;

        case "ast":
            result = ast(blueprint);
            break;
    }

    return result;
}