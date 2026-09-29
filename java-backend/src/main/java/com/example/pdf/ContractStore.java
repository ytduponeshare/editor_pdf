package com.example.pdf;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** SQLite keeps template, assignment/data snapshot and PDF updates durable and atomic. */
final class ContractStore implements AutoCloseable {
    private final Connection database;
    record Contract(ObjectNode view, byte[] pdf) {}
    ContractStore(Path path) throws Exception {
        Files.createDirectories(path.toAbsolutePath().getParent());
        database = DriverManager.getConnection("jdbc:sqlite:" + path.toAbsolutePath());
        try (var statement = database.createStatement()) {
            statement.execute("PRAGMA journal_mode=WAL");
            statement.execute("PRAGMA busy_timeout=5000");
            statement.execute("CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)");
            statement.execute("CREATE TABLE IF NOT EXISTS contracts (id TEXT PRIMARY KEY, data TEXT NOT NULL, pdf BLOB NOT NULL, role_index INTEGER NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)");
            statement.execute("CREATE TABLE IF NOT EXISTS signatures (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL)");
            statement.execute("CREATE TABLE IF NOT EXISTS catalog_records (source_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, row_order INTEGER NOT NULL, PRIMARY KEY(source_id,id))");
        }
        for (String id : List.of("template-demo-html-001", "template-demo-html-long-table-001", "template-demo-html-dynamic-long-table-001", "template-demo-html-anchor-dynamic-long-table-001")) {
            var data = (ObjectNode) Json.resource("/templates/" + id + ".json");
            data.put("status", "published").put("updatedAt", Instant.now().toString());
            try (var statement = database.prepareStatement("INSERT OR IGNORE INTO templates VALUES (?,?,?)")) {
                statement.setString(1, id); statement.setString(2, data.toString()); statement.setString(3, Json.text(data, "updatedAt")); statement.executeUpdate();
            }
        }
        for (String source : List.of("employee", "company", "vesting", "grants", "long-contract-items")) {
            int order = 0;
            for (JsonNode record : Json.resource("/catalog/" + source + "-records.json").path("records")) {
                try (var statement = database.prepareStatement("INSERT OR IGNORE INTO catalog_records VALUES (?,?,?,?)")) {
                    statement.setString(1, source); statement.setString(2, Json.text(record, "id")); statement.setString(3, record.toString()); statement.setInt(4, order++); statement.executeUpdate();
                }
            }
        }
    }
    synchronized List<JsonNode> templates() throws SQLException { return list("SELECT data FROM templates ORDER BY updated_at DESC"); }
    synchronized ObjectNode template(String id) throws SQLException { return find("SELECT data FROM templates WHERE id=?", id); }
    synchronized void saveTemplate(ObjectNode data) throws SQLException {
        try (var statement = database.prepareStatement("INSERT INTO templates VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at")) {
            statement.setString(1, Json.text(data, "id")); statement.setString(2, data.toString()); statement.setString(3, Json.text(data, "updatedAt")); statement.executeUpdate();
        }
    }
    synchronized List<JsonNode> contracts() throws SQLException { return list("SELECT data FROM contracts ORDER BY updated_at DESC LIMIT 100"); }
    synchronized Contract contract(String id) throws SQLException {
        try (var statement = database.prepareStatement("SELECT data,pdf FROM contracts WHERE id=?")) {
            statement.setString(1, id);
            try (var rows = statement.executeQuery()) { return rows.next() ? new Contract((ObjectNode) Json.parse(rows.getString(1)), rows.getBytes(2)) : null; }
        }
    }
    synchronized void insertContract(ObjectNode data, byte[] pdf) throws SQLException {
        try (var statement = database.prepareStatement("INSERT INTO contracts VALUES (?,?,?,?,?,?)")) {
            writeContract(statement, data, pdf); statement.executeUpdate();
        }
    }
    synchronized boolean updateContract(ObjectNode data, byte[] pdf, int expectedRoleIndex) throws SQLException {
        try (var statement = database.prepareStatement("UPDATE contracts SET id=?,data=?,pdf=?,role_index=?,status=?,updated_at=? WHERE id=? AND role_index=? AND status='pending'")) {
            writeContract(statement, data, pdf); statement.setString(7, Json.text(data, "contractId")); statement.setInt(8, expectedRoleIndex);
            return statement.executeUpdate() == 1;
        }
    }
    private void writeContract(java.sql.PreparedStatement statement, ObjectNode data, byte[] pdf) throws SQLException {
        statement.setString(1, Json.text(data, "contractId")); statement.setString(2, data.toString()); statement.setBytes(3, pdf);
        statement.setInt(4, data.path("currentRoleIndex").asInt()); statement.setString(5, Json.text(data, "status")); statement.setString(6, Json.text(data, "updatedAt"));
    }
    synchronized List<JsonNode> records(String source) throws SQLException {
        try (var statement = database.prepareStatement("SELECT data FROM catalog_records WHERE source_id=? ORDER BY row_order")) {
            statement.setString(1, source); try (var rows = statement.executeQuery()) {
                var result = new ArrayList<JsonNode>(); while (rows.next()) result.add(Json.parse(rows.getString(1))); return result;
            }
        }
    }
    synchronized List<JsonNode> signatures(String user) throws SQLException {
        try (var statement = database.prepareStatement("SELECT data FROM signatures WHERE user_id=? ORDER BY created_at DESC")) {
            statement.setString(1, user); try (var rows = statement.executeQuery()) {
                var result = new ArrayList<JsonNode>(); while (rows.next()) result.add(Json.parse(rows.getString(1))); return result;
            }
        }
    }
    synchronized void saveSignature(String user, ObjectNode item) throws SQLException {
        try (var statement = database.prepareStatement("INSERT INTO signatures VALUES (?,?,?,?)")) {
            statement.setString(1, Json.text(item, "id")); statement.setString(2, user); statement.setString(3, item.toString()); statement.setString(4, Json.text(item, "createdAt")); statement.executeUpdate();
        }
    }
    private ObjectNode find(String sql, String id) throws SQLException {
        try (var statement = database.prepareStatement(sql)) {
            statement.setString(1, id); try (var rows = statement.executeQuery()) { return rows.next() ? (ObjectNode) Json.parse(rows.getString(1)) : null; }
        }
    }
    private List<JsonNode> list(String sql) throws SQLException {
        try (var statement = database.createStatement(); var rows = statement.executeQuery(sql)) {
            var result = new ArrayList<JsonNode>(); while (rows.next()) result.add(Json.parse(rows.getString(1))); return result;
        }
    }
    @Override public synchronized void close() throws SQLException { database.close(); }
}
