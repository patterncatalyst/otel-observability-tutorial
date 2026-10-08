package com.example.otel.review;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.graphql.data.method.annotation.Argument;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Controller;

@Controller
public class ReviewController {

    private static final Logger log = LoggerFactory.getLogger(ReviewController.class);

    private static final String SELECT_SQL =
            "SELECT review_id AS id, sku, rating, body FROM reviews";

    private final JdbcClient jdbcClient;

    public ReviewController(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    @QueryMapping
    public List<Review> reviews(@Argument String sku) {
        if (sku == null) {
            return jdbcClient.sql(SELECT_SQL)
                    .query(Review.class)
                    .list();
        }
        return jdbcClient.sql(SELECT_SQL + " WHERE sku = :sku")
                .param("sku", sku)
                .query(Review.class)
                .list();
    }

    @QueryMapping
    public Review review(@Argument String id) {
        Optional<Review> result = jdbcClient.sql(SELECT_SQL + " WHERE review_id = :id")
                .param("id", id)
                .query(Review.class)
                .optional();
        return result.orElse(null);
    }

    @MutationMapping
    public Review addReview(@Argument String sku, @Argument int rating, @Argument String body) {
        String id = UUID.randomUUID().toString();
        jdbcClient.sql("INSERT INTO reviews (review_id, sku, rating, body) VALUES (:id, :sku, :rating, :body)")
                .param("id", id)
                .param("sku", sku)
                .param("rating", rating)
                .param("body", body)
                .update();
        log.info("review added id={} sku={}", id, sku);
        return new Review(id, sku, rating, body);
    }
}
