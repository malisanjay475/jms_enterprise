package com.jmsocean.qc.data.remote

import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.PartMap
import retrofit2.http.Query

interface ApiService {

    // Returns the full Response so 4xx error bodies (geofence, app access) are readable.
    @POST("api/login")
    suspend fun login(@Body req: LoginRequest): Response<ApiEnvelope>

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

    // Self-update feed (static file on the LOCAL server). Response<> so a
    // missing feed (404, before the first publish) is handled as "no update".
    @GET("qc-app/version.json")
    suspend fun appVersion(): Response<AppVersion>

    @GET("api/qc/fpa/status")
    suspend fun fpaStatus(
        @Query("job_card_no") jobCardNo: String,
        @Query("machine") machine: String
    ): FpaStatus

    @GET("api/qc/verify/pending")
    suspend fun verifyPending(
        @Query("machine") machine: String,
        @Query("date") date: String,
        @Query("shift") shift: String
    ): ApiEnvelope

    @POST("api/qc/verify/submit")
    suspend fun verifySubmit(@Body body: VerifySubmitRequest): ApiEnvelope

    @POST("api/dpr/submit")
    suspend fun submitDpr(@Body body: DprSubmitRequest): ApiEnvelope

    @POST("api/qc/hold")
    suspend fun hold(@Body body: HoldRequest): ApiEnvelope

    @GET("api/qc/material-issues")
    suspend fun materialIssues(
        @Query("machine") machine: String?,
        @Query("status") status: String?
    ): ApiEnvelope

    // multipart because the backend route runs multer (media_file optional)
    @Multipart
    @POST("api/qc/material-issues")
    suspend fun createIssue(
        @PartMap fields: Map<String, @JvmSuppressWildcards RequestBody>
    ): ApiEnvelope

    @GET("api/qc/dashboard/kpis")
    suspend fun dashboardKpis(
        @Query("date") date: String?,
        @Query("machine") machine: String?
    ): ApiEnvelope

    @GET("api/qc/colour-balance")
    suspend fun colourBalance(@Query("plan_id") planId: String): ApiEnvelope

    @GET("api/qc/compliance")
    suspend fun compliance(
        @Query("date") date: String,
        @Query("shift") shift: String,
        @Query("machine") machine: String?
    ): ApiEnvelope

    // multipart/form-data — field names must match the backend multer config
    @Multipart
    @POST("api/qc/fpa")
    suspend fun submitFpa(
        @PartMap fields: Map<String, @JvmSuppressWildcards RequestBody>,
        @Part formImage: MultipartBody.Part,
        @Part productImages: List<@JvmSuppressWildcards MultipartBody.Part>
    ): ApiEnvelope
}
