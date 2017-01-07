import transformToAst from "./ast.js"
import Strings from "string"

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

    return result
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

            const actions = getActions(resource.actions);
            for (let method in actions) {
                actions[method]["tags"]= [group.name];
                actions[method]["operationId"] = convertOperationId(method, uri)
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
            "description": action.description,
            "summary": action.description,
            "consumes": [],
            "produces": [],
            "parameters": [],
            "responses": {},
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
            }
        }

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
                    "$ref": "#/definitions/" + convertDefinitionName(definition)
                };
            } else {
                schema["$ref"] = "#/definitions/" + convertDefinitionName(contentItem.element);
            }
        }
    }

    return schema;
}

function convertOperationId(method, uri) {
    let cleanUri = Strings(uri);

    const paramPos = uri.indexOf('{');
    if (paramPos >= 0) {
        cleanUri = cleanUri.left(paramPos);
    }
    cleanUri = cleanUri.replaceAll("/", " ");

    return Strings(method + cleanUri).slugify().camelize().s;
}

function convertDefinitionName(name) {
    return Strings(name).capitalize().camelize();
}