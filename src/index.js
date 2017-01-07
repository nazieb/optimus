import swagger from "./formatters/swagger"

export default function transform(blueprint, opts = {}) {
    let result;

    switch (opts.format) {
        case "swagger":
            result = swagger(blueprint);
            break;
    }

    return result;
}