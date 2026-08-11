package vn.pickpack1291.baohang.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import vn.pickpack1291.baohang.BaoHangApplication
import vn.pickpack1291.baohang.R

class LoginActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)
        val employeeCode = findViewById<EditText>(R.id.etEmployeeCode)
        val password = findViewById<EditText>(R.id.etPassword)
        val login = findViewById<Button>(R.id.btnLogin)
        val progress = findViewById<ProgressBar>(R.id.progressLogin)
        val error = findViewById<TextView>(R.id.tvLoginError)

        login.setOnClickListener {
            val code = employeeCode.text.toString().trim()
            val pass = password.text.toString()
            if (code.isBlank() || pass.isBlank()) {
                error.text = "Nhập đủ mã nhân viên và mật khẩu"
                error.visibility = View.VISIBLE
                return@setOnClickListener
            }
            login.isEnabled = false
            progress.visibility = View.VISIBLE
            error.visibility = View.GONE
            lifecycleScope.launch {
                runCatching { (application as BaoHangApplication).repository.login(code, pass) }
                    .onSuccess {
                        startActivity(Intent(this@LoginActivity, DeviceSetupActivity::class.java))
                        finish()
                    }
                    .onFailure {
                        error.text = it.message ?: "Không đăng nhập được"
                        error.visibility = View.VISIBLE
                        login.isEnabled = true
                        progress.visibility = View.GONE
                    }
            }
        }
    }
}
