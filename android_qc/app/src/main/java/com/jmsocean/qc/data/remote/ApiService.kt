package com.jmsocean.qc.data.remote

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

interface ApiService {

    @POST("api/login")
    suspend fun login(@Body req: LoginRequest): ApiEnvelope

    @GET("api/machines")
    suspend fun machines(
        @Query("process") process: String = "Moulding",
        @Query("line") line: String
    ): ApiEnvelope

    @GET("api/queue")
    suspend fun queue(
        @Query("line") line: String,
        @Query("machine") machine: String
    ): ApiEnvelope
}
