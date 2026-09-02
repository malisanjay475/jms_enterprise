package com.jmsocean.qc.data.remote

import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.PartMap
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

    @GET("api/qc/fpa/status")
    suspend fun fpaStatus(
        @Query("job_card_no") jobCardNo: String,
        @Query("machine") machine: String
    ): FpaStatus

    // multipart/form-data — field names must match the backend multer config
    @Multipart
    @POST("api/qc/fpa")
    suspend fun submitFpa(
        @PartMap fields: Map<String, @JvmSuppressWildcards RequestBody>,
        @Part formImage: MultipartBody.Part,
        @Part productImages: List<@JvmSuppressWildcards MultipartBody.Part>
    ): ApiEnvelope
}
