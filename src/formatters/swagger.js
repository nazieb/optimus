import transformToAst from "./ast.js"
import Strings from "string"
import Regex from "re.js"
import moment from "moment"

let securityDefinitions = {};

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

    const groups = processResourceGroups(ast.resourceGroups, ast.name);
    result["tags"] = groups["tags"];
    result["paths"] = groups["paths"];

    if (ast.content.length == ast.resourceGroups.length + 1) {
        const dataStructures = ast.content[ ast.content.length - 1 ].content;
        result["definitions"] = getDefinitions(dataStructures);
    }

    result["securityDefinitions"] = securityDefinitions;

    return result;
}

function processResourceGroups(resourceGroups, defaultTag) {
    const result = {
        paths: {},
        tags: [],
    };

    for (let group of resourceGroups) {
        const tag = {
            "name": group.name != "" ? group.name : defaultTag,
            "description": group.description,
        };
        result.tags.push(tag);

        for (let resource of group.resources) {
            const uri = cleanQueryParam(resource.uriTemplate);
            const params = getResourceParams(resource);

            const actions = getActions(resource.actions);
            for (let method in actions) {
                actions[method]["tags"]= [group.name != "" ? group.name : defaultTag];
                actions[method]["parameters"] = mergeResourceAndActionParams(params, actions[method]["parameters"]);
            }

            if (!result.paths.hasOwnProperty(uri)) {
                result.paths[uri] = actions;
            } else {
                result.paths[uri] = Object.assign(result.paths[uri], actions);
            }
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
            security: [],
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
        path.security = getSecurityDefinitions(action);

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

            switch (contentItem.element) {
                case "array":
                    const itemsType = contentItem.content[0].element;
                    schema["type"] = "array";
                    schema["items"] = isPrimitiveType(itemsType) ? {
                            "type": itemsType,
                        } : {
                            "$ref": convertDefinitionPath(itemsType),
                        };
                    break;

                case "object":
                    schema["type"] = "object";
                    break;

                default:
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

        for (let header of request.headers) {
            if (/\{.*}/g.test(header.value)) {
                const headerParam = {
                    "name": header.name,
                    "in": "header",
                    "type": "string",
                };

                params.push(headerParam);
            }
        }
    }

    return params;
}

function mergeResourceAndActionParams(resourceParams, actionParams) {
    const result = [];

    if (actionParams.length > 0) {
        for (let actionParam of actionParams) {
            if (actionParam.hasOwnProperty("in") && (actionParam.in == "body" || actionParam.in == "header")) {
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

function getSecurityDefinitions(action) {
    const regexRule = / \{security\:(.*)}/;
    let security = [];

    if (action.examples.length > 0 && action.examples[0].hasOwnProperty("requests")) {
        const request = action.examples[0].requests[0];

        for (let header of request.headers) {
            const match = header.value.match(regexRule);
            if (match != null) {
                const definition = {
                    "in": "header",
                    "name": header.name,
                    "type": match[1],
                };

                const definitionName = header.value.replace(match[0], "");
                securityDefinitions[definitionName] = definition;

                const actionSecurity = {};
                actionSecurity[definitionName] = [];
                security.push(actionSecurity);
            }
        }
    }

    return security;
}

function getDefinitions(dataStructures) {
    const result = {};

    for (let structure of dataStructures) {
        structure = structure.content[0];
        if (isPrimitiveType(structure.element)) {
            continue;
        }

        const definitionName = convertDefinitionName(structure.meta.id);

        const defaultDefinition = {
            "title": structure.meta.id,
            "type": "object",
            "required": [],
        };
        const definition = result[definitionName] ?
            Object.assign(result[definitionName], defaultDefinition) :
            defaultDefinition;

        const properties = {};
        for (let content of structure.content) {
            if (content.element != "member") {
                continue;
            }

            const property = {
                "description": content.meta.description || "",
            };

            const memberName = content.content.key.content;

            const memberType = content.content.value.element;
            if (isPrimitiveType(memberType)) {
                property["type"] = memberType;

                const sample = content.content.value.content;
                if (memberType === "string" && isDateValue(sample)) {
                    property["format"] = "date"
                } else if (memberType === "string" && isDateTimeValue(sample)) {
                    property["format"] = "date-time"
                }
            } else if (isInheritedType(memberType)) {
                property["$ref"] = convertDefinitionPath(memberName);
            } else if (memberType == "enum") {
                const enums = convertEnum(content.content.value.content);

                property["type"] = enums["type"];
                property["enum"] = enums["enum"];
            } else if (memberType == "array") {
                property["type"] = memberType;
                const itemsType = content.content.value.content[0].element;
                property["items"] = isPrimitiveType(itemsType) || itemsType == "object" ? {
                    "type": itemsType,
                } : {
                    "$ref": convertDefinitionPath(itemsType),
                };
            }

            properties[memberName] = property;

            if (
                content.hasOwnProperty("attributes") &&
                content.attributes.hasOwnProperty("typeAttributes") &&
                content.attributes.typeAttributes.indexOf("required") > -1
            ) {
                definition.required.push(memberName);
            }
        }

        if (structure.element !== "object") {
            const parentName = convertDefinitionName(structure.element);
            if (!result[parentName]) {
                result[parentName] = {};
            }
            result[parentName]["discriminator"] = "";

            definition["allOf"] = [
                {
                    "$ref": convertDefinitionPath(structure.element),
                },
                {
                    "properties": properties,
                }
            ];
        } else {
            definition["properties"] = properties;
        }

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

const primitives = ["number", "string", "boolean", "integer"];
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

function isDateValue(dateString) {
    const format = "YYYY-MM-DD";
    const date = moment(dateString, format, true);
    return date.isValid();
}

function isDateTimeValue(dateString) {
    const possibleFormats = [
        "YYYY-MM-DDTHH:mm:ssZ",
        "YYYY-MM-DDTHH:mm:ss.SZ",
        "YYYY-MM-DDTHH:mm:ss.SSZ",
        "YYYY-MM-DDTHH:mm:ss,SZ",
        "YYYY-MM-DDTHH:mm:ss,SSZ",
    ];

    for (let format of possibleFormats) {
        const date = moment(dateString, format, true);
        if (date.isValid()) {
            return true;
        }
    }
    return false;
}

function cleanQueryParam(uri) {
    uri = uri.replace(/\{\?.*}/g, "");
    uri = uri.replace(/\?.*}/g, "}");

    return uri;
}