package com.example.pdf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

final class Json {
    static final ObjectMapper MAPPER = new ObjectMapper();
    static ObjectNode object() { return MAPPER.createObjectNode(); }
    static ArrayNode array() { return MAPPER.createArrayNode(); }
    static JsonNode parse(String text) {
        try { return MAPPER.readTree(text); }
        catch (IOException error) { throw new IllegalArgumentException("JSON 数据格式无效", error); }
    }
    static JsonNode resource(String name) throws IOException {
        try (var input = Json.class.getResourceAsStream(name)) {
            if (input == null) throw new IOException("Missing resource " + name);
            return MAPPER.readTree(input);
        }
    }
    static String resourceText(String name) throws IOException {
        try (var input = Json.class.getResourceAsStream(name)) {
            if (input == null) throw new IOException("Missing resource " + name);
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
    static String text(JsonNode node, String key) { return node == null ? "" : node.path(key).asText(""); }
    static void require(boolean condition, String message) {
        if (!condition) throw new IllegalArgumentException(message);
    }
}
