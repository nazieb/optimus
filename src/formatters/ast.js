import * as Drafter from "drafter.js"

/**
 * Transform a blueprint description into AST
 *
 * @param {string} blueprint
 * @returns {object}
 * @throws error
 */
export default function transformToAst(blueprint) {
    return Drafter.parseSync(blueprint, {type: "ast"});
}