"""API de lista de compras para API Gateway + AWS Lambda + DynamoDB.

La tabla DynamoDB debe tener una clave de partición de texto llamada `id`.
"""

import base64
import json
import os
from datetime import UTC, datetime
from uuid import uuid4

import boto3


# Se puede cambiar el nombre sin modificar el código configurando PANTRY_TABLE.
TABLE_NAME = os.environ.get("PANTRY_TABLE", "PantryProducts")
table = boto3.resource("dynamodb").Table(TABLE_NAME)

FIXED = "FIXED"
WHEN_MISSING = "WHEN_MISSING"
VALID_TYPES = {FIXED, WHEN_MISSING}


def response(status_code, body):
    """Construye una respuesta HTTP JSON, con CORS para un futuro frontend."""
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": json.dumps(body, ensure_ascii=False),
    }


def now():
    """Devuelve una fecha ISO-8601 en UTC para saber cuándo cambió un producto."""
    return datetime.now(UTC).isoformat()


def request_body(event):
    """Lee y valida el JSON enviado por API Gateway."""
    raw_body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw_body = base64.b64decode(raw_body).decode("utf-8")
    try:
        return json.loads(raw_body)
    except json.JSONDecodeError as error:
        raise ValueError("El cuerpo de la solicitud debe ser JSON válido.") from error


def list_all_products():
    """Lee todos los productos; es adecuado para una lista doméstica pequeña."""
    items = []
    result = table.scan()
    items.extend(result.get("Items", []))

    # scan puede paginar si la tabla crece; seguimos hasta terminar.
    while "LastEvaluatedKey" in result:
        result = table.scan(ExclusiveStartKey=result["LastEvaluatedKey"])
        items.extend(result.get("Items", []))

    return sorted(items, key=lambda item: item["name"].casefold())


def create_product(payload):
    """Añade un producto a la lista maestra; nunca se elimina desde esta API."""
    name = str(payload.get("name", "")).strip()
    product_type = str(payload.get("type", "")).upper()

    if not name:
        raise ValueError("El campo 'name' es obligatorio.")
    if product_type not in VALID_TYPES:
        raise ValueError("El campo 'type' debe ser FIXED o WHEN_MISSING.")

    timestamp = now()
    item = {
        "id": str(uuid4()),
        "name": name,
        "type": product_type,
        # Los fijos siempre figuran como necesarios; los otros empiezan en falso.
        "needed": product_type == FIXED,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    table.put_item(Item=item)
    return item


def product_id(event):
    """Obtiene el id de la ruta /products/{id}/need o /products/{id}/bought."""
    value = (event.get("pathParameters") or {}).get("id")
    if not value:
        raise ValueError("Falta el id del producto en la URL.")
    return value


def mark_needed(item_id):
    """Mueve un producto de la lista maestra a la lista de compras."""
    result = table.update_item(
        Key={"id": item_id},
        UpdateExpression="SET needed = :needed, updatedAt = :updated_at",
        ConditionExpression="attribute_exists(id)",
        ExpressionAttributeValues={":needed": True, ":updated_at": now()},
        ReturnValues="ALL_NEW",
    )
    return result["Attributes"]


def mark_bought(item_id):
    """Marca comprado: los condicionales salen de compras; los fijos permanecen."""
    existing = table.get_item(Key={"id": item_id}).get("Item")
    if not existing:
        raise LookupError("No existe un producto con ese id.")

    needed = existing["type"] == FIXED
    result = table.update_item(
        Key={"id": item_id},
        UpdateExpression="SET needed = :needed, updatedAt = :updated_at",
        ExpressionAttributeValues={":needed": needed, ":updated_at": now()},
        ReturnValues="ALL_NEW",
    )
    return result["Attributes"]


def lambda_handler(event, context):
    """Enruta las solicitudes HTTP recibidas desde API Gateway."""
    request_context = event.get("requestContext", {})
    method = request_context.get("http", {}).get("method") or event.get("httpMethod")
    path = event.get("rawPath") or event.get("path") or ""

    # API Gateway incluye /dev, /staging o /prod en la ruta de un stage.
    stage = request_context.get("stage")
    if stage and stage != "$default" and path.startswith(f"/{stage}/"):
        path = path[len(stage) + 1:]

    try:
        if method == "OPTIONS":
            return response(200, {"message": "CORS configurado"})
        if method == "GET" and path == "/master":
            return response(200, {"products": list_all_products()})
        if method == "GET" and path == "/shopping":
            shopping = [item for item in list_all_products() if item["type"] == FIXED or item["needed"]]
            return response(200, {"products": shopping})
        if method == "POST" and path == "/products":
            return response(201, {"product": create_product(request_body(event))})
        if method == "POST" and path.endswith("/need"):
            return response(200, {"product": mark_needed(product_id(event))})
        if method == "POST" and path.endswith("/bought"):
            return response(200, {"product": mark_bought(product_id(event))})
        return response(404, {"message": "Ruta no encontrada."})
    except ValueError as error:
        return response(400, {"message": str(error)})
    except LookupError as error:
        return response(404, {"message": str(error)})
