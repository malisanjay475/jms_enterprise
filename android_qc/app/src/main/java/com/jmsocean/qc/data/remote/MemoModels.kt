package com.jmsocean.qc.data.remote

/** One entry of a memo's action_history: RAISED, ACCEPTED, REPLY, DEVIATION, SOLVED, RERAISED. */
data class MemoStep(val action: String, val by: String, val at: String, val notes: String)

/** A raised memo as shown in the app's "View memos" list. */
data class RaisedMemo(
    val memoNo: String,
    val planId: String,
    val description: String,
    val severity: String,
    val status: String,
    val createdBy: String,
    val createdAt: String,
    val mentioned: String,
    val mediaCount: Int,
    val steps: List<MemoStep>
)
