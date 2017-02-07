import transformToAst from "./ast.js"
import Strings from "string"
import Regex from "re.js"

/**
 *
 *  @param blueprint
 */
export default function transformToSwagger(blueprint) {
    const ast = transformToAst(blueprint).ast;
    const result = {
        "swagger": "2.0",
        "info": {
            "title": ast.name,
            "description": ast.description,
        },
    };

    const groups = processResourceGroups(ast.resourceGroups);
    result["tags"] = groups["tags"];
    result["paths"] = groups["paths"];

    if (ast.content.length == ast.resourceGroups.length + 1) {
        const dataStructures = ast.content[ ast.content.length - 1 ].content;
        result["definitions"] = getDefinitions(dataStructures);
    }

    return result;
}

function processResourceGroups(resourceGroups) {
    const result = {
        paths: {},
        tags: [],
    };

    for (let group of resourceGroups) {
        const tag = {
            "name": group.name,
            "description": group.description,
        };
        result.tags.push(tag);

        for (let resource of group.resources) {
            const uri = resource.uriTemplate;

            const params = getResourceParams(resource);

            const actions = getActions(resource.actions);
            for (let method in actions) {
                actions[method]["tags"]= [group.name];
                actions[method]["parameters"] = mergeResourceAndActionParams(params, actions[method]["parameters"]);
            }

            result.paths[uri] = actions;
        }
    }

    return result;
}

function getActions(actions) {
    const result = {};

    for (let action of actions) {
        const path = {
            description: action.description,
            summary: action.description,
            consumes: [],
            produces: [],
            parameters: [],
            responses: {},
            operationId: "",
        };

        for (let sample of action.examples) {
            const consumableTypes = getRequestsContentTypes(sample.requests);
            path.consumes = path.consumes.concat(consumableTypes);

            for (let response of sample.responses) {
                const contentType = getResponseContentType(response);
                if (path.produces.indexOf(contentType) == -1) {
                    path.produces.push(contentType);
                }

                const pathResponse = {
                    "description": response.description,
                    "schema": {}
                };

                if (contentType == "text/plain") {
                    pathResponse.schema["type"] = "string";
                } else {
                    pathResponse.schema = getResponseSchema(response.content);
                }

                path.responses[response.name] = pathResponse;

                path.operationId = Strings(action.name).slugify().camelize().s;
            }
        }

        path.parameters = getActionParams(action);

        const method = action.method.toLowerCase();
        result[method] = path;
    }


    return result;
}

function getRequestsContentTypes(requests) {
    const types = [];

    for (let request of requests) {
        for (let header of request.headers) {
            if (
                header.name.toLowerCase() == "content-type" &&
                types.indexOf(header.value) == -1
            ) {
                types.push(header.value);
            }
        }
    }

    return types;
}

function getResponseContentType(response) {
    for (let header of response.headers) {
        if (header.name.toLowerCase() == "content-type") {
            return header.value;
        }
    }

    return "";
}

function getResponseSchema(content) {
    const schema = {};

    for (let responseContent of content) {
        if (responseContent.element == "dataStructure") {
            const contentItem = responseContent.content[0];

            if (contentItem.element == "array") {
                const definition = contentItem.content[0].element;
                schema["type"] = "array";
                schema["items"] = {
                    "$ref": convertDefinitionPath(definition)
                };
            } else {
                schema["$ref"] = convertDefinitionPath(contentItem.element);
            }
        }
    }

    return schema;
}

function getResourceParams(resource) {
    let params = [];

    Regex(/{.*?}/).each(resource.uriTemplate, matches => {
        const paramString = Strings(matches[0]).replaceAll(/{|\?|}/, '').s;

        for (let paramName of paramString.split(",")) {
            const location = matches[0].indexOf("?") == -1 ? "path" : "query";
            const param = {
                "name": paramName,
                "in": location,
            };

            params.push(param);
        }
    });
    
    params = [...new Set(params)]; // array unique
    for (let i in params) {
        for (let param of resource.parameters) {
            if (params[i].name != param.name) {
                continue;
            }

            params[i]["required"] = param["required"];
            params[i]["type"] = param["type"];
            params[i]["description"] = param["description"];
        }
    }

    return params;
}

function getActionParams(action) {
    let params = [];

    for (let param of action.parameters) {
        const newParam = {
            "name": param["name"],
            "required": param["required"],
            "type": param["type"],
            "description": param["description"],
        };

        if (!param["required"]) {
            newParam["default"] = param["default"];
        }

        params.push(newParam);
    }

    if (action.examples.length > 0 && action.examples[0].hasOwnProperty("requests")) {
        const request = action.examples[0].requests[0];
        if (request.content.length > 0) {
            const bodyParam = {
                "name": "body",
                "in": "body",
                "required": true,
                "schema": getResponseSchema(request.content),
            };

            params.push(bodyParam);
        }
    }

    return params;
}

function mergeResourceAndActionParams(resourceParams, actionParams) {
    const result = [];

    if (actionParams.length > 0) {
        for (let actionParam of actionParams) {
            if (actionParam.hasOwnProperty("in") && actionParam.in == "body") {
                result.push(actionParam);
                continue;
            }

            for (let resourceParam of resourceParams) {
                if (resourceParam.name == actionParam.name) {
                    actionParam["in"] = resourceParam["in"];
                    result.push(actionParam);
                }
            }
        }
    } else if (resourceParams.length > 0) {
        for (let resourceParam of resourceParams) {
            result.push(resourceParam);
        }
    }

    return result;
}

function getDefinitions(dataStructures) {
    const result = {};

    for (let structure of dataStructures) {
        structure = structure.content[0];
        const definition = {
            "title": structure.meta.id,
            "type": "object",
            "properties": {},
        };

        for (let content of structure.content) {
            if (content.element != "member") {
                continue;
            }

            const property = {
                "description": content.meta.description,
            };

            const memberName = content.content.key.content;

            const memberType = content.content.value.element;
            if (isPrimitiveType(memberType)) {
                property["type"] = memberType;
            } else if (isInheritedType(memberType)) {
                property["$ref"] = convertDefinitionPath(memberName);
            } else if (memberType == "enum") {
                const enums = convertEnum(content.content.value.content);

                property["type"] = enums["type"];
                property["enum"] = enums["enum"];
            }

            definition.properties[memberName] = property;
        }

        const definitionName = convertDefinitionName(structure.meta.id);
        result[definitionName] = definition;
    }

    return result;
}

function convertEnum(members) {
    const result = [];
    const values = [];

    for (let member of members) {
        result["type"] = member.element;
        values.push(member.content);
    }

    result["enum"] = values;
    return result;
}

function convertDefinitionName(name) {
    return Strings(name).capitalize().camelize().s;
}

function convertDefinitionPath(name) {
    return "#/definitions/" + convertDefinitionName(name);
}

const primitives = ["number", "string", "boolean"];
const structures = ["array", "object", "enum"];

function isPrimitiveType(type) {
    return (primitives.indexOf(type) != -1);
}

function isStructureType(type) {
    return (structures.indexOf(type) != -1);
}

function isInheritedType(type) {
    return (
        !isPrimitiveType(type) &&
        !isStructureType(type)
    )
}