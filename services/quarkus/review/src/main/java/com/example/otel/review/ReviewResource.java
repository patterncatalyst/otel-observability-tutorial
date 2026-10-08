package com.example.otel.review;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import javax.sql.DataSource;

import org.eclipse.microprofile.graphql.GraphQLApi;
import org.eclipse.microprofile.graphql.Mutation;
import org.eclipse.microprofile.graphql.Name;
import org.eclipse.microprofile.graphql.NonNull;
import org.eclipse.microprofile.graphql.Query;
import org.jboss.logging.Logger;

import jakarta.inject.Inject;

/**
 * GraphQL API mirroring services/spring/review's schema.graphqls:
 *   Query    reviews(sku: String): [Review!]!
 *   Query    review(id: ID!): Review
 *   Mutation addReview(sku: String!, rating: Int!, body: String!): Review!
 */
@GraphQLApi
public class ReviewResource {

    private static final Logger LOG = Logger.getLogger(ReviewResource.class);

    private static final String SELECT_SQL = "SELECT review_id, sku, rating, body FROM reviews";

    @Inject
    DataSource dataSource;

    @Query
    public List<@NonNull Review> reviews(@Name("sku") String sku) throws Exception {
        String sql = sku == null ? SELECT_SQL : SELECT_SQL + " WHERE sku = ?";
        try (Connection conn = dataSource.getConnection();
                PreparedStatement stmt = conn.prepareStatement(sql)) {
            if (sku != null) {
                stmt.setString(1, sku);
            }
            List<Review> results = new ArrayList<>();
            try (ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    results.add(toReview(rs));
                }
            }
            return results;
        }
    }

    @Query
    public Review review(@Name("id") @NonNull String id) throws Exception {
        try (Connection conn = dataSource.getConnection();
                PreparedStatement stmt = conn.prepareStatement(SELECT_SQL + " WHERE review_id = ?")) {
            stmt.setString(1, id);
            try (ResultSet rs = stmt.executeQuery()) {
                return rs.next() ? toReview(rs) : null;
            }
        }
    }

    @Mutation
    @NonNull
    public Review addReview(@Name("sku") @NonNull String sku, @Name("rating") int rating,
            @Name("body") @NonNull String body) throws Exception {
        String id = UUID.randomUUID().toString();
        try (Connection conn = dataSource.getConnection();
                PreparedStatement stmt = conn.prepareStatement(
                        "INSERT INTO reviews (review_id, sku, rating, body) VALUES (?, ?, ?, ?)")) {
            stmt.setString(1, id);
            stmt.setString(2, sku);
            stmt.setInt(3, rating);
            stmt.setString(4, body);
            stmt.executeUpdate();
        }
        LOG.infof("review added id=%s sku=%s", id, sku);
        return new Review(id, sku, rating, body);
    }

    private Review toReview(ResultSet rs) throws Exception {
        return new Review(rs.getString("review_id"), rs.getString("sku"), rs.getInt("rating"), rs.getString("body"));
    }
}
